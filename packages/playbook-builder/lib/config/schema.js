'use strict'

module.exports = {
  playbook: {
    doc: 'Location of the playbook file.',
    format: String,
    default: undefined,
    arg: 'playbook',
  },
  site: {
    start_page: {
      doc: 'The start page for the site, redirected from the site index.',
      format: String,
      default: undefined,
      arg: 'start-page',
    },
    title: {
      doc: 'The title of the site.',
      format: String,
      default: undefined,
      arg: 'title',
    },
    url: {
      doc: 'The base URL (absolute URL or pathname) of the published site. Should not include a trailing slash.',
      format: 'url-or-pathname',
      default: undefined,
      arg: 'url',
      env: 'URL',
    },
    robots: {
      doc: 'Controls generation of robots.txt if site.url is set (allowed values: allow, disallow, or custom string).',
      format: String,
      default: undefined,
    },
    keys: {
      doc: 'An API key (in the form name=value) to pass to the UI model. May be specified multiple times.',
      format: 'primitive-map',
      default: {},
      arg: 'key',
    },
    // NOTE used to map arg and env for site.keys.google_analytics key
    __private__google_analytics_key: {
      doc: [
        'The Google Analytics account key.',
        '(Deprecated; will be removed in Antora 4; define using --key google-analytics=<key> instead)',
      ].join('\n'),
      format: String,
      default: undefined,
      arg: 'google-analytics-key',
      env: 'GOOGLE_ANALYTICS_KEY',
    },
  },
  content: {
    branches: {
      doc: 'The default branch pattern to use when no specific pattern is provided.',
      format: Array,
      default: ['v*', 'master'],
    },
    edit_url: {
      doc: 'The default edit URL setting when no specific setting is provided.',
      format: 'boolean-or-string',
      default: true,
    },
    sources: {
      doc: 'The list of git repositories + branch patterns to use.',
      format: Array,
      default: [],
    },
    tags: {
      doc: 'The default tag pattern to use when no specific pattern is provided.',
      format: Array,
      default: undefined,
    },
  },
  ui: {
    bundle: {
      url: {
        doc: 'The URL of the UI bundle. Can be a path on the local filesystem.',
        format: String,
        arg: 'ui-bundle-url',
        default: null,
      },
      snapshot: {
        doc: 'Whether the bundle URL points to a snapshot that changes over time.',
        format: Boolean,
        default: false,
      },
      start_path: {
        doc: 'The relative path inside the bundle from which to start reading files.',
        format: String,
        default: '',
      },
    },
    output_dir: {
      doc: 'The output directory path relative to the site root where the UI files should be written.',
      format: String,
      default: '_',
    },
    default_layout: {
      doc: 'The default layout to apply to pages that do not specify a layout.',
      format: String,
      default: undefined,
    },
    supplemental_files: {
      doc: 'Supplemental file list or a directory of files to append to the UI bundle.',
      format: 'dir-or-virtual-files',
      default: undefined,
    },
  },
  asciidoc: {
    attributes: {
      doc: 'A document attribute to set on each page. May be specified multiple times.',
      format: 'map',
      default: {},
      arg: 'attribute',
    },
    extensions: {
      doc: 'A list of require paths for registering asciidoctor extensions per instance of the AsciiDoc processor.',
      format: Array,
      default: [],
    },
  },
  git: {
    credentials: {
      path: {
        doc: 'The path to a git credentials file matching the format used by git-credential-store.',
        format: String,
        default: undefined,
        arg: 'git-credentials-path',
        env: 'GIT_CREDENTIALS_PATH',
      },
      contents: {
        doc: 'The git credentials data matching the format used by git-credentials-store (optionally comma-separated).',
        format: String,
        default: undefined,
        env: 'GIT_CREDENTIALS',
      },
    },
    ensure_git_suffix: {
      doc: 'Instructs the git client to automatically append .git to the repository URL if absent.',
      format: Boolean,
      default: true,
    },
  },
  runtime: {
    cache_dir: {
      doc: 'The cache directory. (default: antora folder under cache dir for current user)',
      format: String,
      default: undefined,
      arg: 'cache-dir',
      env: 'ANTORA_CACHE_DIR',
    },
    fetch: {
      doc: 'Download updates from remote resources. Includes content repositories and the UI bundle.',
      format: Boolean,
      default: false,
      arg: 'fetch',
    },
    quiet: {
      doc: 'Do not write any messages to stdout.',
      format: Boolean,
      default: false,
      arg: 'quiet',
    },
    silent: {
      doc: 'Suppress all messages.',
      format: Boolean,
      default: false,
      arg: 'silent',
    },
  },
  urls: {
    html_extension_style: {
      doc: 'The user-facing URL extension to use for HTML pages.',
      format: ['default', 'drop', 'indexify'],
      default: 'default',
      arg: 'html-url-extension-style',
    },
    latest_version_segment_strategy: {
      doc: 'The strategy to use for cloaking the latest version or prerelease version segment in the URL.',
      format: ['replace', 'redirect:to', 'redirect:from'],
      default: undefined,
    },
    latest_prerelease_version_segment: {
      doc: 'The value to use instead of the latest prerelease version segment in the URL.',
      format: String,
      default: undefined,
    },
    latest_version_segment: {
      doc: 'The value to use instead of the latest version segment in the URL.',
      format: String,
      default: undefined,
    },
    redirect_facility: {
      doc: 'The facility for handling page alias and start page redirections.',
      format: ['disabled', 'httpd', 'netlify', 'nginx', 'static'],
      default: 'static',
      arg: 'redirect-facility',
    },
  },
  output: {
    clean: {
      doc: 'Remove destination path before publishing (fs only).',
      format: Boolean,
      default: false,
      arg: 'clean',
    },
    dir: {
      doc: 'The directory where the site should be published. (default: build/site)',
      format: String,
      default: undefined,
      arg: 'to-dir',
    },
    destinations: {
      doc: 'A list of destinations where the generated site should be published.',
      format: Array,
      default: undefined,
    },
  },
  extensions: {
    doc: 'A list of require paths for registering Antora pipeline extensions, with configuration.',
    format: Array,
    default: [],
    arg: 'pipeline-extension',
  },
  pipelineStages: {
    asciidocLoader: {
      doc: 'asciidoc-loader implementation package.',
      format: String,
      default: undefined,
    },
    contentAggregator: {
      doc: 'content-aggregator implementation package.',
      format: String,
      default: undefined,
    },
    contentClassifier: {
      doc: 'content-classifier implementation package.',
      format: String,
      default: undefined,
    },
    documentConverter: {
      doc: 'document-converter implementation package.',
      format: String,
      default: undefined,
    },
    navigationBuilder: {
      doc: 'navigation-builder implementation package.',
      format: String,
      default: undefined,
    },
    pageComposer: {
      doc: 'page-composer implementation package.',
      format: String,
      default: undefined,
    },
    redirectProducer: {
      doc: 'redirect-producer implementation package.',
      format: String,
      default: undefined,
    },
    siteMapper: {
      doc: 'site-mapper implementation package.',
      format: String,
      default: undefined,
    },
    sitePublisher: {
      doc: 'site-publisher implementation package.',
      format: String,
      default: undefined,
    },
    uiLoader: {
      doc: 'ui-loader implementation package.',
      format: String,
      default: undefined,
    },
  },
}
