export type VisitorEventInput = {
  requestId: string;
  kind: 'page_view' | 'game_open';
  path: string;
  gameId?: string;
  version?: string;
  referrer?: string;
};

export type VisitorAnalytics = {
  window: { days: 7 | 30; start: string; end: string; timezone: 'UTC' };
  totals: { visitors: number; pageViews: number; gameOpens: number };
  daily: { day: string; visitors: number; pageViews: number; gameOpens: number }[];
  countries: { country: string | null; visitors: number; events: number }[];
  games: { gameId: string; name: string; opens: number; visitors: number }[];
};

export type VisitorRecords = {
  page: number;
  pageSize: number;
  total: number;
  records: {
    id: number; visitor: string; occurredAt: string;
    kind: 'page_view' | 'game_open'; path: string;
    ip: string; country: string | null; username: string | null;
    gameId: string | null; gameName: string | null; gameVersion: string | null;
    referrerHost: string | null; userAgent: string;
  }[];
};
