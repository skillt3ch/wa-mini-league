// Shared Discord webhook notifier. Used to ping admins in a Discord
// channel when a game is submitted or an issue is reported — no bot, just
// an "Incoming Webhook" URL per channel (Server Settings > Integrations >
// Webhooks in Discord), stored as a Cloudflare secret.
//
// Callers should always wrap this in context.waitUntil() so a slow/down
// Discord never delays or affects the actual submission response — and
// notifyDiscord() itself never throws, so a missing/misconfigured webhook
// just means that one notification silently doesn't happen.

const COLOUR = {
  cyan: 0x55FFFF,
  grey: 0x9C9CA3,
  red: 0xFF5555,
  magenta: 0xFF66FF
};

const CATEGORY_LABELS = { game_error: 'Game Error', player: 'Player Behaviour', bug: 'Site Issue, Bug or Suggestion', other: 'Other' };

export async function notifyDiscord(webhookUrl, payload) {
  if (!webhookUrl) return; // not configured for this event type — skip quietly
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // Discord unreachable/misconfigured — never let this affect the caller.
  }
}

// game: { players: [{ rawName }], winnerName, isDraw, outcomeStatus, note, winnerSource }
export function buildGameEmbed(game, origin) {
  const playersStr = game.players.map(p => p.rawName).join(' vs ');
  const unresolved = game.outcomeStatus === 'unresolved';
  const selfReported = game.winnerSource === 'submitter';
  const resultLabel = unresolved
    ? 'Needs review — WADB could not verify a winner'
    : (game.isDraw ? 'Draw' : game.winnerName) + (selfReported ? ' (self-reported, not WADB-verified)' : '');

  const fields = [
    { name: 'Players', value: playersStr || 'unknown' },
    { name: 'Result', value: resultLabel || 'unknown' }
  ];
  if (unresolved && game.note) fields.push({ name: 'Why', value: game.note });

  return {
    embeds: [{
      title: 'New game submitted',
      color: unresolved ? COLOUR.red : selfReported ? COLOUR.magenta : COLOUR.cyan,
      fields,
      url: `${origin}/standings.html`,
      timestamp: new Date().toISOString()
    }]
  };
}

// report: { category, message, reporterName }
export function buildReportEmbed(report, origin, adminRoleId) {
  const messageValue = report.message.length > 1000 ? report.message.slice(0, 1000) + '…' : report.message;

  return {
    content: adminRoleId ? `<@&${adminRoleId}>` : undefined,
    embeds: [{
      title: 'New issue reported',
      color: COLOUR.magenta,
      fields: [
        { name: 'Category', value: CATEGORY_LABELS[report.category] || 'Other' },
        { name: 'Reporter', value: report.reporterName || 'anonymous' },
        { name: 'Message', value: messageValue }
      ],
      url: `${origin}/admin.html`,
      timestamp: new Date().toISOString()
    }]
  };
}
