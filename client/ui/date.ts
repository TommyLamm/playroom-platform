


export const date = (value: string) =>
  new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' }).format(new Date(value));
