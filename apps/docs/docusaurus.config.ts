import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Solder',
  tagline: 'A modern Solana backend framework for shipping web2 backends faster',
  favicon: 'img/logo.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://solder.build',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'solder-build', // Usually your GitHub org/user name.
  projectName: 'solder', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/solder-build/solder/tree/main/apps/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/logo.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Solder',
      logo: {
        alt: 'Solder Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://solder.build',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://github.com/solder-build/solder',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://x.com/solder_official',
          label: 'X/Twitter',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/docs/api-reference/solder-table',
            },
            {
              label: 'Architecture',
              to: '/docs/architecture',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'X/Twitter',
              href: 'https://x.com/solder_official',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/solder-build/solder',
            },
            {
              label: 'Website',
              href: 'https://solder.build',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Examples',
              href: 'https://github.com/solder-build/solder/tree/main/apps/example-app',
            },
            {
              label: 'Legends.fun',
              href: 'https://www.legends.fun/products/3fcaabac-2fe8-402b-a1fd-53833b66dfad',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Solder. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
