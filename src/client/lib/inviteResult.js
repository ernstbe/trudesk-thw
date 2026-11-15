import helpers from 'lib/helpers'

// #invite: tell the admin what happened to the invitation. When no mail
// went out (mailer disabled or sending failed) the link is shown so it can
// be passed on by hand, e.g. via messenger.
export function showInviteResult (invite) {
  if (!invite) return
  if (invite.mailed) {
    helpers.UI.showSnackbar('Einladung per E-Mail versendet (7 Tage gültig)')
    return
  }
  helpers.UI.showSnackbar('Keine E-Mail versendet – bitte den Einladungslink selbst weitergeben', true)
  window.prompt('Einladungslink (7 Tage gültig, nur einmal verwendbar) – bitte kopieren und weitergeben:', invite.url)
}
