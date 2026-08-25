import { toIsoUtc } from './_util.js';

// Shared audit-log helpers for games. Every change to a game's winner/
// outcome — the original submission, an admin's manual correction, or an
// admin-triggered WADB recheck (whether or not it actually changed
// anything) — writes one row here. Nothing about a game's result changes
// silently.

// before/after are either null (no prior state, e.g. a brand-new
// submission) or { winnerSource, winnerPlayerId, isDraw, outcomeStatus }.
export async function logGameAudit(env, { gameId, action, actor, adminIp = null, before = null, after = null, note = null }) {
  await env.DB.prepare(`
    INSERT INTO game_audit_log
      (game_id, action, actor, admin_ip,
       old_winner_source, old_winner_player_id, old_is_draw, old_outcome_status,
       new_winner_source, new_winner_player_id, new_is_draw, new_outcome_status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    gameId, action, actor, adminIp,
    before?.winnerSource ?? null,
    before?.winnerPlayerId ?? null,
    before && before.isDraw != null ? (before.isDraw ? 1 : 0) : null,
    before?.outcomeStatus ?? null,
    after?.winnerSource ?? null,
    after?.winnerPlayerId ?? null,
    after && after.isDraw != null ? (after.isDraw ? 1 : 0) : null,
    after?.outcomeStatus ?? null,
    note
  ).run();
}

// Full audit trail for one game, oldest first, with old/new winner names
// resolved so the admin panel doesn't have to cross-reference player IDs.
export async function getGameAuditLog(env, gameId) {
  const rows = await env.DB.prepare(`
    SELECT gal.id, gal.action, gal.actor, gal.admin_ip,
           gal.old_winner_source, gal.old_is_draw, gal.old_outcome_status,
           gal.new_winner_source, gal.new_is_draw, gal.new_outcome_status,
           gal.note, gal.created_at,
           oldp.name AS old_winner_name, newp.name AS new_winner_name
    FROM game_audit_log gal
    LEFT JOIN players oldp ON oldp.id = gal.old_winner_player_id
    LEFT JOIN players newp ON newp.id = gal.new_winner_player_id
    WHERE gal.game_id = ?
    ORDER BY gal.created_at ASC, gal.id ASC
  `).bind(gameId).all();

  return rows.results.map(r => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    adminIp: r.admin_ip,
    old: { winnerSource: r.old_winner_source, winnerName: r.old_winner_name, isDraw: !!r.old_is_draw, outcomeStatus: r.old_outcome_status },
    new: { winnerSource: r.new_winner_source, winnerName: r.new_winner_name, isDraw: !!r.new_is_draw, outcomeStatus: r.new_outcome_status },
    note: r.note,
    createdAt: toIsoUtc(r.created_at)
  }));
}
