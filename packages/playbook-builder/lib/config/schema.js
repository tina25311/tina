'use strict'

module.exports = {
  playbook: {
    doc: 'Location of the playbook file.',
    format: String,
    default: undefined,
    env: 'PLAYBOOK',
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
      doc: 'The base URL of the published site. Should not include trailing slash.',
      format: String,
      default: undefined,
      env: 'URL',
      arg: 'url',
    },
    //root: {
    //  doc: 'The name of the component to use as the root of the site.',
    //  format: String,
    //  default: undefined,
    //},
    //aspect: {
    //  doc: 'The name of the aspect navigation to make available on every page in the site.',
    //  format: String,
    //  default: undefined,
    //},
    //nav: {
    //  doc: 'The list of descriptors which define the aspect navigation domains.',
    //  format: Array,
    //  default: undefined,
    //},
    keys: {
      google_analytics: {
        doc: 'The Google Analytics account key.',
        format: String,
        default: undefined,
        arg: 'google-analytics-key',
      },
      swiftype: {
        doc: 'The key to activate the Swiftype widget.',
        format: String,
        default: undefined,
        arg: 'swiftype-key',
      },
    },
  },
  content: {
    branches: {
      doc: 'The default branch pattern to use when no specific pattern is provided',
      format: Array,
      default: ['v*', 'master'],
    },
    sources: {
      doc: 'The list of git repositories + branch patterns to use.',
      format: Array,
      default: [],
    },
  },
  ui: {
    bundle: {
      doc: 'The URL of the UI bundle. Can be a path on the local filesystem.',
      format: String,
      arg: 'ui-bundle',
      default: null,
    },
    start_path: {
      doc: 'The relative path inside the bundle from which to start reading files.',
      format: String,
      default: '',
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
      format: (val) => {
        if (!(typeof val === 'string' || Array.isArray(val))) {
          throw new Error('expected directory string or file list')
        }
      },
      default: undefined,
    },
  },
  runtime: {
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
      doc: 'Controls how the URL extension for HTML pages is handled.',
      format: ['default', 'drop', 'indexify'],
      default: 'default',
      arg: 'html-url-extension-style',
    },
    aspect_page_strategy: {
      doc: 'Controls how links to pages in aspect domains are generated.',
      format: ['path', 'query'],
      default: 'path',
      arg: 'aspect-page-url-strategy',
    },
  },
  redirects: {
    doc: 'Generate nginx config file containing URL redirects for page aliases.',
    format: Boolean,
    default: false,
    arg: 'redirects',
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
}
