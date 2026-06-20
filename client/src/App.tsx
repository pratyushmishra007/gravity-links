import React, { useState } from 'react';
import axios from 'axios';
import { Link2, Copy, ExternalLink, Check, AlertCircle, Loader2, BarChart } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

function App() {
  const [originalUrl, setOriginalUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const handleViewStats = async () => {
    if (!shortUrl) return;
    setIsLoadingStats(true);
    const id = shortUrl.split('/').pop();
    try {
      const response = await axios.get(`${API_URL}/stats/${id}`);
      setStats(response.data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // We point to our local server for now
  const API_URL = 'http://localhost:3000';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setShortUrl('');
    
    if (!originalUrl) {
      setError('Please enter a valid URL');
      return;
    }

    try {
      setIsLoading(true);
      const response = await axios.post(`${API_URL}/shorten`, {
        originalUrl
      });
      
      setShortUrl(response.data.shortUrl);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="app-container">
      <div className="glass-panel">
        <h1>Gravity Links</h1>
        <p className="subtitle">
          Transform your long, ugly URLs into short, memorable links.
          Lightning fast and permanently stored.
        </p>

        <form onSubmit={handleSubmit} className="input-group">
          <input
            type="url"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
            placeholder="Paste your long URL here (e.g. https://google.com)"
            className="input-field"
            required
          />
          <button 
            type="submit" 
            className="primary-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="spinner" />
                Shortening...
              </>
            ) : (
              <>
                <Link2 size={20} />
                Shorten URL
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="error-message">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {shortUrl && (
          <div className="glass-panel-small">
            <div className="result-header">
              <Check size={20} />
              URL Shortened Successfully!
            </div>
            
            <a href={shortUrl} target="_blank" rel="noopener noreferrer" className="short-url-link">
              {shortUrl}
            </a>

            <div style={{ display: 'flex', justifyContent: 'center', margin: '1.5rem 0', background: 'white', padding: '1rem', borderRadius: '1rem', width: 'fit-content', marginInline: 'auto' }}>
              <QRCodeSVG value={shortUrl} size={160} level="H" includeMargin={true} />
            </div>

            <div className="action-buttons" style={{ justifyContent: 'center' }}>
              <button onClick={handleCopy} className="secondary-button">
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <a 
                href={shortUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="secondary-button"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={16} />
                Visit
              </a>
              <button onClick={handleViewStats} className="secondary-button" disabled={isLoadingStats}>
                {isLoadingStats ? <Loader2 size={16} className="spinner" /> : <BarChart size={16} />}
                Analytics
              </button>
            </div>

            {stats && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
                  <BarChart size={18} color="#10b981" /> 
                  Real-Time Analytics
                </h3>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '0.75rem', flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#60a5fa' }}>{stats.totalClicks}</div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Clicks</div>
                  </div>
                </div>
                
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#94a3b8' }}>Recent Activity</h4>
                <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '0.5rem' }}>
                  {stats.clicks.length === 0 ? (
                    <p style={{ fontSize: '0.875rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>No clicks recorded yet.</p>
                  ) : (
                    stats.clicks.map((click: any, i: number) => (
                      <div key={i} style={{ fontSize: '0.8rem', padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#f8fafc' }}>{new Date(click.createdAt).toLocaleString()}</span>
                        <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>IP: {click.ip || 'Unknown'}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
