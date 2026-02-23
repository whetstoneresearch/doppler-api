export interface MetricsSnapshot {
  startedAt: string;
  uptimeSec: number;
  http: {
    totalRequests: number;
    byStatusClass: Record<string, number>;
    avgDurationMs: number;
  };
}

export class MetricsRegistry {
  private readonly startedAt = new Date();
  private totalRequests = 0;
  private totalDurationMs = 0;
  private byStatusClass: Record<string, number> = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
    other: 0,
  };

  recordHttp(statusCode: number, durationMs: number): void {
    this.totalRequests += 1;
    this.totalDurationMs += durationMs;

    if (statusCode >= 200 && statusCode < 300) this.byStatusClass['2xx'] += 1;
    else if (statusCode >= 300 && statusCode < 400) this.byStatusClass['3xx'] += 1;
    else if (statusCode >= 400 && statusCode < 500) this.byStatusClass['4xx'] += 1;
    else if (statusCode >= 500 && statusCode < 600) this.byStatusClass['5xx'] += 1;
    else this.byStatusClass.other += 1;
  }

  snapshot(): MetricsSnapshot {
    const uptimeSec = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSec,
      http: {
        totalRequests: this.totalRequests,
        byStatusClass: { ...this.byStatusClass },
        avgDurationMs: this.totalRequests > 0 ? this.totalDurationMs / this.totalRequests : 0,
      },
    };
  }
}
