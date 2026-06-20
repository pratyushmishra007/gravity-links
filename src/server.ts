import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import cors from 'cors'; // Added for production
import Redis from 'ioredis';

// Initialize Redis Client
// By default, ioredis connects to localhost:6379, which perfectly matches our Docker setup!
const redis = new Redis();

// --- PRODUCTION CHECKS ---
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("CRITICAL ERROR: DATABASE_URL is missing in .env file");
}

// Initialize Prisma 7 with Postgres Adapter
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 1. Create an Express application instance
const app = express();

// 2. Define the port our server will listen on (Dynamic for deployment)
const PORT = process.env.PORT || 3000;

// 3. Middleware
app.use(cors()); // Allows frontend websites to talk to our API
app.use(express.json()); // Allows our server to read JSON data sent in requests

// --- DSA: BASE 62 ENCODING ---
// Characters available for our short URL: 10 numbers + 26 lowercase + 26 uppercase = 62 characters
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encodeBase62(num: number): string {
    if (num === 0) return ALPHABET[0];
    
    let encoded = "";
    while (num > 0) {
        const remainder = num % 62;
        // Prepend the mapped character to our string
        encoded = ALPHABET[remainder] + encoded;
        // Divide by 62 and round down
        num = Math.floor(num / 62);
    }
    return encoded;
}

// --- MIDDLEWARE: RATE LIMITING ---
// A basic Fixed Window Rate Limiter using Redis
// Limits a user (by IP address) to 10 requests per minute.
const rateLimiter = async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
    // In production, you'd get the real IP from the load balancer headers.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const redisKey = `rate_limit:${ip}`;

    // Atomically increment the request count for this IP
    const currentCount = await redis.incr(redisKey);

    if (currentCount === 1) {
        // If this is their first request, set the counter to expire in 60 seconds
        await redis.expire(redisKey, 60);
    }

    if (currentCount > 10) {
        // HTTP 429: Too Many Requests
        res.status(429).json({ error: 'Too many requests! Please try again in a minute.' });
        return;
    }

    // Pass control to the next function (the actual route)
    next();
};

// --- ENDPOINTS ---

// 1. POST /shorten: Takes a long URL, creates a short ID, and saves it.
// Notice we pass 'rateLimiter' BEFORE our main logic to protect the database!
app.post('/shorten', rateLimiter, async (req: Request, res: Response): Promise<void> => {
    const { originalUrl } = req.body;

    if (!originalUrl) {
        res.status(400).json({ error: 'originalUrl is required' });
        return; 
    }
    // OPTIMIZATION: Check if we already shortened this URL!
    // If we did, just return the existing short link so analytics are consolidated.
    const existingLink = await prisma.link.findFirst({
        where: { originalUrl: originalUrl }
    });

    if (existingLink) {
        res.status(200).json({
            message: 'URL already shortened',
            shortUrl: `http://localhost:${PORT}/${existingLink.shortId}`,
        });
        return;
    }

    // STEP 1: Insert into the database with a temporary ID.
    // Why? We need PostgreSQL to generate the unique auto-incrementing integer ID for us first!
    const tempLink = await prisma.link.create({
        data: {
            shortId: `temp_${Date.now()}_${Math.random()}`,
            originalUrl: originalUrl
        }
    });

    // STEP 2: Convert the integer ID (e.g., 10024) into a Base62 string (e.g., "2BB")
    const finalShortId = encodeBase62(tempLink.id);

    // STEP 3: Update the row with the actual short string
    await prisma.link.update({
        where: { id: tempLink.id },
        data: { shortId: finalShortId }
    });

    res.status(201).json({
        message: 'URL shortened successfully',
        shortUrl: `http://localhost:${PORT}/${finalShortId}`,
    });
});

// 2. GET /:id : Looks up the short ID and redirects to the long URL.
app.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params; 

    const shortIdStr = String(id);

    // 1. Check Redis Cache First (Time Complexity: O(1))
    const cachedUrl = await redis.get(shortIdStr);

    if (cachedUrl) {
        // CACHE HIT: We found it in memory! Redirect instantly.
        console.log(`Cache HIT for ${shortIdStr}`);
        res.redirect(302, cachedUrl);
        
        // Fire-and-forget analytics tracking (Does not slow down the user's redirect)
        prisma.click.create({
            data: { shortId: shortIdStr, ip: req.ip || req.socket.remoteAddress, userAgent: req.headers['user-agent'] }
        }).catch(err => console.error("Analytics Error:", err));
        
        return;
    }

    console.log(`Cache MISS for ${shortIdStr}. Querying Database...`);
    // 2. Cache Miss: REAL DATABASE QUERY! (Time Complexity: O(log N))
    const link = await prisma.link.findUnique({
        where: {
            shortId: shortIdStr
        }
    });

    if (link) {
        // 3. Save it to Redis so the NEXT user gets a Cache Hit!
        // EX 3600 means the cache expires after 3600 seconds (1 hour)
        await redis.set(shortIdStr, link.originalUrl, 'EX', 3600);

        res.redirect(302, link.originalUrl);

        // Fire-and-forget analytics tracking
        prisma.click.create({
            data: { shortId: shortIdStr, ip: req.ip || req.socket.remoteAddress, userAgent: req.headers['user-agent'] }
        }).catch(err => console.error("Analytics Error:", err));
    } else {
        res.status(404).json({ error: 'URL not found' });
    }
});

// 3. GET /stats/:id : Retrieves analytics data for a specific short link
app.get('/stats/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    
    const link = await prisma.link.findUnique({
        where: { shortId: String(id) },
        include: { 
            clicks: {
                orderBy: { createdAt: 'desc' }
            } 
        }
    });

    if (!link) {
        res.status(404).json({ error: 'URL not found' });
        return;
    }

    res.json({
        originalUrl: link.originalUrl,
        shortId: link.shortId,
        totalClicks: link.clicks.length,
        clicks: link.clicks
    });
});

// 5. Start the server
app.listen(PORT, () => {
    console.log(`Server is running and listening on http://localhost:${PORT}`);
});
