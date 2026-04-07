const S3_BASE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

export async function onRequest(context) {
    const path = context.params.path.join('/');
    const cacheKey = new Request(`${S3_BASE}/${path}`, context.request);

    // Check Cloudflare edge cache first
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) return response;

    // Fetch from S3
    const s3Response = await fetch(`${S3_BASE}/${path}`);
    if (!s3Response.ok) {
        return new Response(`S3 fetch failed: ${s3Response.status}`, { status: s3Response.status });
    }

    // Return with cache headers — SRS params are immutable
    response = new Response(s3Response.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
        },
    });

    // Store in edge cache
    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}
