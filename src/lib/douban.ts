/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Referer: 'https://movie.douban.com/',
    Accept: 'application/json, text/plain, */*',
  };
  const cookie = process.env.DOUBAN_COOKIE;
  if (cookie) headers['Cookie'] = cookie;

  const fetchOptions = { signal: controller.signal, headers };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`豆瓣返回了非 JSON 数据: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
