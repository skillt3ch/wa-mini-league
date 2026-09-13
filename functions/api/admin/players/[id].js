import { isAdmin, unauthorized } from '../../../_authAdmin.js';

// DELETE /api/admin/players/:id — remove a player outright. Only allowed
// when the player has zero games attached (otherwise deleting would orphan
// game_players rows / silently rewrite history) — merge into another
// player instead if games exist.
//
// game_players has ON DELETE CASCADE for player_id, but game_audit_log's
// old_winner_player_id/new_winner_player_id (migration 0005) don't — a
// player with 0 *current* games can still be referenced there from earlier
// history (an admin edit, a WADB re-check, or an identity correction that
// later got superseded), and D1 enforces foreign keys by default. Deleting
// such a player without clearing those references first throws an uncaught
// SQLITE_CONSTRAINT_FOREIGNKEY error — confirmed against a local D1
// instance with this exact schema — which (with no try/catch here) came
// back as a non-JSON error page, so the admin page's `await res.json()`
// on the failure path threw too and the whole thing looked like a silent
// no-op. Nulling those columns first is safe: the rest of that audit row
// (source/status/note/timestamps) still tells the story, it just can't
// link to a player that no longer exists.
export async function onRequestDelete(context) {
  try {
    const { env, request, params } = context;
    if (!isAdmin(request, env)) return unauthorized();

    const id = Number(params.id);
    const player = await env.DB.prepare(`SELECT id FROM players WHERE id = ?`).bind(id).first();
    if (!player) return Response.json({ error: 'Player not found.' }, { status: 404 });

    const { count } = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM game_players WHERE player_id = ?`
    ).bind(id).first();
    if (count > 0) {
      return Response.json(
        { error: `This player appears in ${count} game${count === 1 ? '' : 's'}. Merge into another player instead of deleting.` },
        { status: 409 }
      );
    }

    await env.DB.prepare(`UPDATE game_audit_log SET old_winner_player_id = NULL WHERE old_winner_player_id = ?`).bind(id).run();
    await env.DB.prepare(`UPDATE game_audit_log SET new_winner_player_id = NULL WHERE new_winner_player_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM aliases WHERE player_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM players WHERE id = ?`).bind(id).run();

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: 'Unexpected server error: ' + (err?.message || err) }, { status: 500 });
  }
}
