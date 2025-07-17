class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.timers = {};
    this.enabled = true;
    this.maxStoredMetrics = 100;
    this.loadSettings();
  }

  async loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(['performanceEnabled']);
      this.enabled = result.performanceEnabled !== false;
    }
  }

  startTimer(name) {
    if (!this.enabled) return;
    
    this.timers[name] = {
      start: performance.now(),
      mark: `${name}-start`
    };
    
    if (typeof performance.mark === 'function') {
      performance.mark(this.timers[name].mark);
    }
  }

  endTimer(name, metadata = {}) {
    if (!this.enabled || !this.timers[name]) return null;
    
    const endTime = performance.now();
    const duration = endTime - this.timers[name].start;
    
    if (typeof performance.mark === 'function') {
      const endMark = `${name}-end`;
      performance.mark(endMark);
      
      if (typeof performance.measure === 'function') {
        try {
          performance.measure(name, this.timers[name].mark, endMark);
        } catch (e) {
          console.warn('Performance measure failed:', e);
        }
      }
    }

    const metric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.recordMetric(metric);
    delete this.timers[name];
    
    return duration;
  }

  recordMetric(metric) {
    if (!this.enabled) return;
    
    if (!this.metrics[metric.name]) {
      this.metrics[metric.name] = [];
    }
    
    this.metrics[metric.name].push(metric);
    
    // Keep only the most recent metrics
    if (this.metrics[metric.name].length > this.maxStoredMetrics) {
      this.metrics[metric.name] = this.metrics[metric.name].slice(-this.maxStoredMetrics);
    }
    
    this.saveMetricsToStorage();
  }

  async saveMetricsToStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const summary = this.getMetricsSummary();
        await chrome.storage.local.set({ 
          performanceMetrics: summary,
          lastUpdated: Date.now()
        });
      } catch (e) {
        console.warn('Failed to save performance metrics:', e);
      }
    }
  }

  getMetricsSummary() {
    const summary = {};
    
    for (const [name, metrics] of Object.entries(this.metrics)) {
      if (metrics.length === 0) continue;
      
      const durations = metrics.map(m => m.duration);
      const recent = metrics.slice(-10); // Last 10 measurements
      
      summary[name] = {
        count: metrics.length,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        recent: recent.map(m => ({
          duration: m.duration,
          timestamp: m.timestamp,
          metadata: m.metadata
        })),
        lastRecorded: metrics[metrics.length - 1].timestamp
      };
    }
    
    return summary;
  }

  getSlowOperations(threshold = 1000) {
    const summary = this.getMetricsSummary();
    const slow = [];
    
    for (const [name, stats] of Object.entries(summary)) {
      if (stats.avg > threshold || stats.max > threshold * 2) {
        slow.push({
          name,
          avgDuration: stats.avg,
          maxDuration: stats.max,
          count: stats.count
        });
      }
    }
    
    return slow.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  recordError(operation, error, duration = null) {
    if (!this.enabled) return;
    
    const errorMetric = {
      name: `${operation}_error`,
      duration: duration || 0,
      timestamp: Date.now(),
      metadata: {
        error: error.message || error,
        stack: error.stack,
        type: 'error'
      }
    };
    
    this.recordMetric(errorMetric);
  }

  recordMemoryUsage(operation) {
    if (!this.enabled || typeof performance.memory === 'undefined') return;
    
    const memoryMetric = {
      name: `${operation}_memory`,
      duration: 0,
      timestamp: Date.now(),
      metadata: {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        type: 'memory'
      }
    };
    
    this.recordMetric(memoryMetric);
  }

  clearMetrics() {
    this.metrics = {};
    this.timers = {};
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove(['performanceMetrics', 'lastUpdated']);
    }
  }

  enable() {
    this.enabled = true;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ performanceEnabled: true });
    }
  }

  disable() {
    this.enabled = false;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ performanceEnabled: false });
    }
  }

  // Async wrapper for timing async operations
  async timeAsync(name, asyncFn, metadata = {}) {
    this.startTimer(name);
    try {
      const result = await asyncFn();
      this.endTimer(name, { ...metadata, success: true });
      return result;
    } catch (error) {
      this.endTimer(name, { ...metadata, success: false, error: error.message });
      this.recordError(name, error);
      throw error;
    }
  }

  // Sync wrapper for timing sync operations
  timeSync(name, syncFn, metadata = {}) {
    this.startTimer(name);
    try {
      const result = syncFn();
      this.endTimer(name, { ...metadata, success: true });
      return result;
    } catch (error) {
      this.endTimer(name, { ...metadata, success: false, error: error.message });
      this.recordError(name, error);
      throw error;
    }
  }
}

// Global instance
window.performanceMonitor = new PerformanceMonitor();