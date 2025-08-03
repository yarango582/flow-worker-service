export interface HealthCheck {
  component: string;
  status: 'healthy' | 'degraded' | 'critical';
  message?: string;
  responseTime?: number;
  timestamp: string;
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'critical';
  checks: HealthCheck[];
  timestamp: string;
}

export interface SimpleHealthResult {
  status: string;
  timestamp: string;
}

export interface ReadinessResult {
  ready: boolean;
  timestamp: string;
}
