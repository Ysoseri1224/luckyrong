export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/cet6')) {
      const path = url.pathname.replace('/cet6', '') || '/';
      const targetUrl = `https://cet6-camp.pages.dev${path}${url.search}`;
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
      });
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }

    const targetUrl = `https://luckyrong.pages.dev${url.pathname}${url.search}`;
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  },
};
