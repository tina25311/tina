'use strict'

const get = require('simple-get')
const { HttpProxyAgent, HttpsProxyAgent } = require('hpagent')
const shouldProxy = require('should-proxy')

module.exports = ({ httpProxy, httpsProxy, noProxy }) => {
  return async ({ core, emitter, emitterPreifx, url, method, headers, body }) => {
    if (body && Array.isArray(body)) {
      const buffers = []
      for await (const chunk of body) buffers.push(Buffer.from(chunk))
      body = Buffer.concat(buffers)
    }
    const proxy = url.startsWith('https:')
      ? { ProxyAgent: HttpsProxyAgent, url: httpsProxy }
      : { ProxyAgent: HttpProxyAgent, url: httpProxy }
    let agent
    if (proxy.url && shouldProxy(url, { no_proxy: noProxy })) {
      // see https://github.com/delvedor/hpagent/issues/18
      const { protocol, hostname, port, username, password } = new URL(proxy.url)
      const proxyUrl = { protocol, hostname, port, username: username || null, password: password || null }
      agent = new proxy.ProxyAgent({ proxy: proxyUrl })
    }
    return new Promise((resolve, reject) =>
      get({ url, agent, method, headers, body }, (err, res) => {
        if (err) return reject(err)
        const { url, method, statusCode, statusMessage, headers } = res
        resolve({ url, method, statusCode, statusMessage, headers, body: res })
      })
    )
  }
}
