'use strict'

const File = require('vinyl')
const versionCompare = require('@antora/content-classifier/lib/util/version-compare-desc')

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>'
const SITEMAPS_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const SITEMAP_STEM = 'sitemap'
const SITEMAP_PREFIX = 'sitemap-'

/**
 * Maps the site by creating sitemap files.
 *
 * Iterates over the specified pages and creates sitemap files that list the
 * URLs for these pages. If there's only one component, all the entries are
 * added to a sitemap.xml file that gets published to the root of the site. If
 * there's more than one component, the sitemaps are partitioned into separate
 * files by component (e.g., sitemap-component-name.xml). The URL of those
 * component sitemaps are listed in the sitemap.xml index file that gets
 * published to the root of the site.
 *
 * The entries are listed in alphabetical order by URL. URLs with newer
 * versions are listed before URLs of older versions according to the semantic
 * versioning-based sorting algorithm used in Antora.
 *
 * The sitemaps are only created if a url for the site has been defined to
 * the site.url property in the playbook.
 *
 * In addition, if the site.robots key is present, a robots.txt file is generated.
 * The string 'allow' results in an all-access robots.txt, the string 'disallow'
 * results in a no-access robots.txt, otherwise the key value is copied into
 * robots.txt, ending with a newline.
 *
 * @memberof site-mapper
 *
 * @param {Object} playbook - The configuration object for Antora.
 * @param {Object} playbook.site - Site-related configuration data.
 * @param {String} playbook.site.url - The base URL of the site.
 * @param {Array<File>} pages - The publishable pages to to map.
 * @returns {Array<File>} An array of File objects that represent the sitemaps.
 */
function mapSite (playbook, pages) {
  if (!pages.length) return []
  let siteUrl = playbook.site.url
  if (!siteUrl || siteUrl.charAt() === '/') return []
  if (siteUrl.charAt(siteUrl.length - 1) === '/') siteUrl = siteUrl.substr(0, siteUrl.length - 1)
  const lastmodISO = new Date().toISOString()
  let sitemaps = pages.reduce((accum, file) => {
    const componentSitemap = getSitemapForComponent(siteUrl, accum, file.src.component)
    const version = file.src.version
    componentSitemap.entries.push({
      url: file.pub.url,
      version,
      lastmodISO,
    })
    componentSitemap.versions.add(version)
    return accum
  }, new Map())

  sitemaps = Array.from(sitemaps.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((component) => {
      const sitemap = sitemaps.get(component)
      let sitemapEntries = sitemap.entries
      delete sitemap.entries
      sitemapEntries.sort((a, b) => a.url.localeCompare(b.url))
      if (sitemap.versions.size > 1) sitemapEntries.sort((a, b) => versionCompare(a.version, b.version))
      delete sitemap.versions
      sitemapEntries = sitemapEntries.map(createUrlElement.bind(null, siteUrl))
      sitemap.contents = Buffer.from(createSitemapDocument(sitemapEntries))
      return sitemap
    })

  let sitemapIndex
  if (sitemaps.length > 1) {
    const sitemapIndexEntries = sitemaps.map(createSitemapElement.bind(null, siteUrl))
    sitemapIndex = new File({ contents: Buffer.from(createSitemapIndexDocument(sitemapIndexEntries)) })
    sitemaps.unshift(sitemapIndex)
  } else {
    sitemapIndex = sitemaps[0]
  }
  const basename = SITEMAP_STEM + '.xml'
  sitemapIndex.out = { path: basename }
  sitemapIndex.pub = { url: '/' + basename }
  const robots = playbook.site.robots
  if (robots) {
    sitemaps.push(createRobots(robots))
  }
  return sitemaps
}

function getSitemapForComponent (siteUrl, sitemaps, component) {
  if (sitemaps.has(component)) {
    return sitemaps.get(component)
  } else {
    const basename = `${SITEMAP_PREFIX}${component}.xml`
    const componentSitemap = new File({
      entries: [],
      out: { path: basename },
      pub: { url: '/' + basename },
      versions: new Set(),
    })
    sitemaps.set(component, componentSitemap)
    return componentSitemap
  }
}

function createSitemapElement (siteUrl, sitemap) {
  return `<sitemap>
<loc>${siteUrl}${escapeHtml(sitemap.pub.url)}</loc>
</sitemap>`
}

function createSitemapIndexDocument (entries) {
  return `${XML_DECL}
<sitemapindex xmlns="${SITEMAPS_NS}">
${entries.join('\n')}
</sitemapindex>`
}

function createUrlElement (siteUrl, entry) {
  return `<url>
<loc>${siteUrl}${escapeHtml(entry.url)}</loc>
<lastmod>${entry.lastmodISO}</lastmod>
</url>`
}

function createSitemapDocument (entries) {
  return `${XML_DECL}
<urlset xmlns="${SITEMAPS_NS}">
${entries.join('\n')}
</urlset>`
}

function escapeHtml (str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function createRobots (robots) {
  if (robots === 'allow') {
    robots = `User-agent: *
Allow: /
`
  } else if (robots === 'disallow') {
    robots = `User-agent: *
Disallow: /
`
  } else {
    robots = robots.trim() + '\n'
  }
  return new File({
    out: { path: 'robots.txt' },
    pub: { url: '/robots.txt' },
    contents: Buffer.from(robots),
  })
}

module.exports = mapSite
