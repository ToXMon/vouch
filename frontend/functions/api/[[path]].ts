interface Env {
  RUNTIME_URL: string
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context
  
  const runtimeUrl = env.RUNTIME_URL || 'https://jd5gauqmh1ai5advf8s5m81nko.ingress.oregon.skyfall.cz'
  const pathParam = (params.path as string[] | undefined)?.join('/') ?? ''
  const url = new URL(request.url)
  const targetUrl = `${runtimeUrl}/api/${pathParam}${url.search}`
  
  const headers = new Headers(request.headers)
  headers.set('Host', new URL(runtimeUrl).host)
  
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    })
    
    const respHeaders = new Headers(response.headers)
    respHeaders.set('Access-Control-Allow-Origin', '*')
    
    return new Response(response.body, {
      status: response.status,
      headers: respHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Runtime unavailable', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
