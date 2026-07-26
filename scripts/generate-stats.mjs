import { mkdir, writeFile } from 'node:fs/promises'

const token = process.env.GITHUB_TOKEN
const username = process.env.GITHUB_USERNAME

if (!token || !username) {
  throw new Error('GITHUB_TOKEN and GITHUB_USERNAME are required.')
}

const query = `
  query ProfileStats($login: String!) {
    user(login: $login) {
      followers {
        totalCount
      }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        isFork: false
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
        }
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
  }
`

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Aryan-Jivani-profile-stats',
  },
  body: JSON.stringify({
    query,
    variables: { login: username },
  }),
})

if (!response.ok) {
  throw new Error(`GitHub API request failed with status ${response.status}.`)
}

const payload = await response.json()

if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join('; '))
}

const user = payload.data?.user

if (!user) {
  throw new Error(`GitHub user "${username}" was not found.`)
}

const repositories = user.repositories.nodes
const contributions = user.contributionsCollection
const stars = repositories.reduce(
  (total, repository) => total + repository.stargazerCount,
  0,
)

const languageTotals = new Map()

for (const repository of repositories) {
  for (const edge of repository.languages.edges) {
    const current = languageTotals.get(edge.node.name) ?? {
      color: edge.node.color || '#64748b',
      size: 0,
    }

    current.size += edge.size
    languageTotals.set(edge.node.name, current)
  }
}

const languages = [...languageTotals.entries()]
  .map(([name, details]) => ({
    name,
    ...details,
  }))
  .sort((first, second) => second.size - first.size)
  .slice(0, 6)

const totalLanguageSize = languages.reduce(
  (total, language) => total + language.size,
  0,
)

const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  )

const metric = (label, value, x, y) => `
  <g transform="translate(${x} ${y})">
    <text class="metric-value" x="0" y="0">${escapeXml(value)}</text>
    <text class="metric-label" x="0" y="24">${escapeXml(label)}</text>
  </g>
`

const cardStyles = `
  <style>
    .title {
      fill: #22d3ee;
      font: 700 18px "Segoe UI", Arial, sans-serif;
    }
    .metric-value {
      fill: #f8fafc;
      font: 700 23px "Segoe UI", Arial, sans-serif;
    }
    .metric-label {
      fill: #94a3b8;
      font: 12px "Segoe UI", Arial, sans-serif;
    }
    .language-name {
      fill: #f8fafc;
      font: 600 13px "Segoe UI", Arial, sans-serif;
    }
    .language-percent {
      fill: #94a3b8;
      font: 12px "Segoe UI", Arial, sans-serif;
    }
  </style>
`

const statsSvg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="495"
  height="230"
  viewBox="0 0 495 230"
  role="img"
  aria-labelledby="stats-title stats-description"
>
  <title id="stats-title">${escapeXml(username)}'s GitHub statistics</title>
  <desc id="stats-description">
    Automatically generated public GitHub activity statistics.
  </desc>
  ${cardStyles}
  <defs>
    <linearGradient id="stats-accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee" />
      <stop offset="100%" stop-color="#8b5cf6" />
    </linearGradient>
  </defs>
  <rect
    x="0.5"
    y="0.5"
    width="494"
    height="229"
    rx="8"
    fill="#070b14"
    stroke="#1e293b"
  />
  <rect x="0" y="0" width="5" height="230" rx="3" fill="url(#stats-accent)" />
  <text class="title" x="28" y="39">GitHub Activity</text>
  <path d="M28 54 H467" stroke="#1e293b" />

  ${metric(
    'Contributions · last year',
    contributions.contributionCalendar.totalContributions,
    28,
    96,
  )}
  ${metric('Commits · last year', contributions.totalCommitContributions, 265, 96)}
  ${metric('Pull requests · last year', contributions.totalPullRequestContributions, 28, 160)}
  ${metric('Stars earned', stars, 265, 160)}

  <g transform="translate(28 202)">
    <circle cx="5" cy="-4" r="4" fill="#22d3ee">
      <animate
        attributeName="opacity"
        values="0.4;1;0.4"
        dur="2s"
        repeatCount="indefinite"
      />
    </circle>
    <text class="metric-label" x="17" y="0">
      ${user.repositories.totalCount} public repos · ${user.followers.totalCount} followers
    </text>
  </g>
</svg>
`.trim()

const languageRows =
  languages.length > 0
    ? languages
        .map((language, index) => {
          const percentage =
            totalLanguageSize === 0
              ? 0
              : Math.round((language.size / totalLanguageSize) * 100)
          const y = 77 + index * 27
          const barWidth = Math.max(4, Math.round(280 * (percentage / 100)))

          return `
  <g transform="translate(28 ${y})">
    <circle cx="5" cy="-4" r="5" fill="${escapeXml(language.color)}" />
    <text class="language-name" x="18" y="0">${escapeXml(language.name)}</text>
    <rect x="140" y="-11" width="280" height="8" rx="4" fill="#172033" />
    <rect
      x="140"
      y="-11"
      width="${barWidth}"
      height="8"
      rx="4"
      fill="${escapeXml(language.color)}"
    />
    <text class="language-percent" x="432" y="0">${percentage}%</text>
  </g>
`
        })
        .join('')
    : `
  <text class="metric-label" x="28" y="90">
    Language data will appear as public repositories grow.
  </text>
`

const languagesSvg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="495"
  height="250"
  viewBox="0 0 495 250"
  role="img"
  aria-labelledby="languages-title languages-description"
>
  <title id="languages-title">${escapeXml(username)}'s most-used languages</title>
  <desc id="languages-description">
    Languages measured by code size across public, non-fork repositories.
  </desc>
  ${cardStyles}
  <defs>
    <linearGradient id="languages-accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#22d3ee" />
    </linearGradient>
  </defs>
  <rect
    x="0.5"
    y="0.5"
    width="494"
    height="249"
    rx="8"
    fill="#070b14"
    stroke="#1e293b"
  />
  <rect x="0" y="0" width="5" height="250" rx="3" fill="url(#languages-accent)" />
  <text class="title" x="28" y="39">Most Used Languages</text>
  <path d="M28 54 H467" stroke="#1e293b" />
  ${languageRows}
</svg>
`.trim()

await mkdir('profile', { recursive: true })
await Promise.all([
  writeFile('profile/stats.svg', statsSvg, 'utf8'),
  writeFile('profile/top-langs.svg', languagesSvg, 'utf8'),
])

console.log(`Generated profile statistics for ${username}.`)
