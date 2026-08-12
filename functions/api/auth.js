// 替换成你自己的认证 Worker 地址
// 例如：const AUTH_WORKER_URL = 'https://your-worker.your-account.workers.dev/api/auth';
const AUTH_WORKER_URL = '你的worker地址放这里';

function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const body = await request.text();

    const upstream = await fetch(AUTH_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json'
      },
      body: body
    });

    const responseBody = await upstream.arrayBuffer();

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: '登录服务暂时不可用，请稍后重试'
    }), {
      status: 502,
      headers: jsonHeaders()
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: false,
    error: '此接口只支持 POST 请求'
  }), {
    status: 405,
    headers: jsonHeaders()
  });
}
