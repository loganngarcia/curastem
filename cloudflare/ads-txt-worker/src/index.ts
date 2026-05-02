const ADS_TXT = "google.com, pub-9747624035157768, DIRECT, f08c47fec0942fa0\n"

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === "/ads.txt") {
            return new Response(ADS_TXT, {
                headers: {
                    "content-type": "text/plain; charset=utf-8",
                    "cache-control": "public, max-age=300",
                },
            })
        }

        return new Response("Not found", { status: 404 })
    },
}
