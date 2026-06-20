# Gravity Links: Architecture & Data Flows

This document contains detailed system diagrams to help you study the architecture, explain it in interviews, or use it for future reference.

---

## 1. High-Level System Architecture
This diagram outlines the physical deployment architecture and how the different services talk to each other across the internet.

```mermaid
graph TD
    %% Define styles
    classDef frontend fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#fff
    classDef backend fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff
    classDef database fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff
    classDef cache fill:#ef4444,stroke:#b91c1c,stroke-width:2px,color:#fff

    User((User))
    
    subgraph Vercel
        React[React Frontend]:::frontend
    end
    
    subgraph Render
        LB[Load Balancer]
        Node[Node.js Express API]:::backend
        Redis[(Redis Cache)]:::cache
        PG[(PostgreSQL DB)]:::database
    end

    User <-->|Browses| React
    User -.->|Clicks Short Link| LB
    React -.->|API Requests| LB
    
    LB <--> Node
    Node <-->|Rate Limit & Cache lookups| Redis
    Node <-->|Persistent Storage| PG
```

---

## 2. The "URL Shortening" Flow (`POST /shorten`)
This diagram shows the exact logical sequence of events that happens when a user clicks the "Shorten" button in the React UI. Notice how we optimize the database by checking for existing URLs first.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant React as React Frontend
    participant API as Express Server
    participant Redis as Redis Cache
    participant PG as PostgreSQL DB

    User->>React: Enters Long URL
    React->>API: POST /shorten { originalUrl }
    
    API->>Redis: Check Rate Limit (IP)
    alt Over Limit ( > 10 req/min )
        Redis-->>API: Deny Request
        API-->>React: 429 Too Many Requests
    else Under Limit
        Redis-->>API: Allow Request
        
        API->>PG: findFirst(originalUrl)
        alt URL Already Exists
            PG-->>API: Return Existing Link Data
            API-->>React: 200 OK (Return Existing Short URL)
        else Brand New URL
            API->>PG: Insert temporary row
            PG-->>API: Return integer ID (e.g. 10024)
            Note over API: Math algorithm converts 10024 to Base62 (e.g. "2BB")
            API->>PG: Update row with "2BB"
            API-->>React: 201 Created (Return New Short URL)
        end
    end
```

---

## 3. The "Redirect & Analytics" Flow (`GET /:id`)
This is the most critical performance path in the app. This diagram demonstrates how we use Redis to achieve O(1) response times, and how we use "Fire-and-Forget" asynchronous operations to log analytics without slowing down the user.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant LB as Load Balancer
    participant API as Express Server
    participant Redis as Redis Cache
    participant PG as PostgreSQL DB

    User->>LB: GET /2BB (Visits Short Link)
    LB->>API: Forwards request with real IP
    
    API->>Redis: Query: GET "2BB"
    alt Cache HIT (URL found in Redis)
        Redis-->>API: Returns Long URL
        API-->>User: 302 Redirect instantly!
        Note over API,PG: Async "Fire-and-forget" Tracking
        API-)PG: prisma.click.create(ip, shortId)
    else Cache MISS (Not in Redis)
        Redis-->>API: Null
        API->>PG: findUnique(shortId: "2BB")
        PG-->>API: Returns Long URL
        API->>Redis: Save to Cache (Expires in 1 hr)
        API-->>User: 302 Redirect to Long URL!
        Note over API,PG: Async "Fire-and-forget" Tracking
        API-)PG: prisma.click.create(ip, shortId)
    end
```

---

## 4. Entity Relationship Diagram (ERD)
This represents the relational architecture of your PostgreSQL database tables.

```mermaid
erDiagram
    LINK {
        Int id PK "Auto-incrementing integer"
        String shortId UK "Unique Base62 string (e.g., '2BB')"
        String originalUrl "The destination URL"
        DateTime createdAt 
    }
    
    CLICK {
        Int id PK "Auto-incrementing integer"
        String shortId FK "References Link.shortId"
        String ip "User's public IP address"
        String userAgent "Browser metadata"
        DateTime createdAt
    }

    LINK ||--o{ CLICK : "has many"
```
