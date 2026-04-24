(() => {
  // --- SAFTECH RESOLUTIONS CONFIGURATION ---
  // This connects your Cloudflare frontend to your Render backend
  const PROD_BACKEND_BASE = "https://saftech-rental-system-management.onrender.com";

  function normalizeBase(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  const { protocol, hostname, port, origin } = window.location;

  // 1. Local development check
  // If you are running HTML on 5500/5501 locally, it still looks for your local Node server on 3000
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port && port !== "3000") {
    window.SAFTECH_API_URL = `${protocol}//${hostname}:3000/api`;
    console.log("Saftech API Mode: Local Development");
  } 
  // 2. Production (Live) Mode
  // This uses your Render URL when the site is live on Cloudflare
  else if (PROD_BACKEND_BASE) {
    window.SAFTECH_API_URL = `${normalizeBase(PROD_BACKEND_BASE)}/api`;
    console.log("Saftech API Mode: Live Production (Render)");
  } 
  // 3. Fallback
  else {
    window.SAFTECH_API_URL = `${origin}/api`;
  }

  // ========== ENHANCED SECURITY FUNCTIONS ==========
  
  /**
   * Check if user is authenticated
   * @param {string} requiredRole - Optional: 'caretaker' or 'tenant'
   * @returns {boolean} - True if authenticated and has required role
   */
  window.checkAuth = function(requiredRole = null) {
    const role = localStorage.getItem('saftech_role');
    const activeUnit = sessionStorage.getItem('activeUnit');
    const currentPage = window.location.pathname.split('/').pop();
    
    // Public pages that don't require authentication
    const publicPages = ['index.html', 'login.html', ''];
    
    // If current page is public, allow access
    if (publicPages.includes(currentPage) || currentPage === '') {
      return true;
    }
    
    // Check if user is authenticated
    if (!role) {
      console.warn('No authentication found. Redirecting to login...');
      sessionStorage.setItem('redirectAfterLogin', currentPage);
      window.location.href = 'index.html';
      return false;
    }
    
    // Role-based access control
    const caretakerPages = ['dashboard.html', 'settings.html', 'verify.html'];
    const tenantPages = ['tenant.html'];
    
    // Check role-based access
    if (requiredRole === 'caretaker' && role !== 'caretaker') {
      console.warn('Access denied: Caretaker role required');
      if (role === 'tenant') {
        window.location.href = 'tenant.html';
      } else {
        window.location.href = 'index.html';
      }
      return false;
    }
    
    if (requiredRole === 'tenant' && role !== 'tenant') {
      console.warn('Access denied: Tenant role required');
      if (role === 'caretaker') {
        window.location.href = 'dashboard.html';
      } else {
        window.location.href = 'index.html';
      }
      return false;
    }
    
    // Auto-redirect if user is on wrong page for their role
    if (role === 'caretaker' && tenantPages.includes(currentPage)) {
      window.location.href = 'dashboard.html';
      return false;
    }
    
    if (role === 'tenant' && caretakerPages.includes(currentPage)) {
      window.location.href = 'tenant.html';
      return false;
    }
    
    // Verify session is still valid (optional: check with server)
    console.log(`✓ Authenticated as ${role} on ${currentPage}`);
    return true;
  };
  
  /**
   * Get current user information
   * @returns {Object} - User role and unit data
   */
  window.getCurrentUser = function() {
    const role = localStorage.getItem('saftech_role');
    let unit = null;
    
    if (role === 'tenant') {
      const unitData = sessionStorage.getItem('activeUnit');
      if (unitData) {
        try {
          unit = JSON.parse(unitData);
        } catch (e) {
          console.error('Failed to parse unit data:', e);
        }
      }
    }
    
    return {
      role: role,
      unit: unit,
      isAuthenticated: !!role,
      isCaretaker: role === 'caretaker',
      isTenant: role === 'tenant'
    };
  };
  
  /**
   * Logout user and clear all sessions
   * @param {boolean} redirect - Whether to redirect to login page
   */
  window.logout = function(redirect = true) {
    // Clear all authentication data
    localStorage.removeItem('saftech_role');
    sessionStorage.removeItem('activeUnit');
    sessionStorage.removeItem('redirectAfterLogin');
    
    console.log('User logged out successfully');
    
    if (redirect) {
      window.location.href = 'index.html';
    }
  };
  
  /**
   * Secure fetch wrapper with authentication headers
   * @param {string} url - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise} - Fetch promise
   */
  window.secureFetch = async function(url, options = {}) {
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': localStorage.getItem('saftech_role') || 'guest',
        'X-Session-ID': sessionStorage.getItem('sessionId') || 'unknown'
      }
    };
    
    const mergedOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...(options.headers || {})
      }
    };
    
    try {
      const response = await fetch(url, mergedOptions);
      
      // If unauthorized, redirect to login
      if (response.status === 401) {
        console.warn('Unauthorized access detected. Logging out...');
        window.logout(true);
        throw new Error('Session expired. Please login again.');
      }
      
      return response;
    } catch (error) {
      console.error('Secure fetch error:', error);
      throw error;
    }
  };
  
  /**
   * Check server connection status
   * @returns {Promise<boolean>} - True if server is reachable
   */
  window.checkServerConnection = async function() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${window.SAFTECH_API_URL}/units`, { 
        signal: controller.signal,
        method: 'HEAD'
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.error('Server connection check failed:', error);
      return false;
    }
  };
  
  /**
   * Generate session ID for tracking
   */
  function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  // Initialize session ID if not exists
  if (!sessionStorage.getItem('sessionId')) {
    sessionStorage.setItem('sessionId', generateSessionId());
  }
  
  // Periodically check server connection (every 30 seconds)
  if (typeof window !== 'undefined') {
    setInterval(async () => {
      const isConnected = await window.checkServerConnection();
      if (!isConnected && window.getCurrentUser().isAuthenticated) {
        console.warn('Server connection lost');
        // Optionally show a notification to user
        const event = new CustomEvent('server-connection-lost');
        window.dispatchEvent(event);
      }
    }, 30000);
  }
  
  console.log('Saftech Security Module Initialized');
})();
