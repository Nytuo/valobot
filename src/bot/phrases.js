// Phrases du bot : français, humour bon enfant, mèmes et références (certaines en anglais)
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const recruitment = [
  "🔎 Recherche **désespérément** un 5ème. Profil : respire, a une souris, accepte de se faire appeler « mon reuf ».",
  "📣 Une party Valo se forme ! Niveau exigé : savoir où est la touche pour acheter. Même ça, on peut négocier.",
  "🪖 Jett veut dash, Sage veut rez, et personne ne veut être Sentinelle. On a besoin de vous.",
  "🍿 La soirée est offerte, la défaite est en option. Venez, c'est gratuit.",
  "🎲 Ce soir on tente un truc fou : jouer ensemble ET s'écouter en vocal. (Spoiler : on y arrivera pas.)",
  "🐣 « Je lance une partie, 10 minutes max » — dernières paroles célèbres, il est déjà 3h du matin."
];

const joined = [
  "{name} a rejoint la squad ! Le niveau moyen vient de monter. Ou de descendre. On verra. 🎲",
  "{name} débarque ! Quelqu'un lui dit où est le point de spawn ? 🧭",
  "Un {name} sauvage apparaît ! Il avait promis de pas jouer Reyna. 🦇",
  "{name} est dans la place. Les gars, planquez les snacks. 🍪",
  "{name} rejoint la party et jure qu'il joue « pour le fun ». On connaît la chanson. 🎶"
];

const locked = [
  "⏳ **Deadline passée**, mais les retardataires sont acceptés jusqu'au début du match. On est cools, on est une famille. 🐌",
  "⏳ **Votes fermés**... enfin « fermés », la porte est juste entrouverte. Tu peux encore voter. 🚪"
];

const lockedSquad = [
  "Squad prête ! Respirez, hydratez-vous, et pas de « c'est la faute du ping » avant le round 3 : {mentions}",
  "Squad bouclée ! Que la force (et le wifi) soit avec vous : {mentions}",
  "C'est parti ! Rappel : l'ult de Sage se garde pour quelqu'un qui est encore vivant : {mentions}"
];

const cancelled = [
  "🛑 **Session annulée** par {who}. Les chaises sont remises, le canapé reprend ses droits. 🛋️",
  "🛑 **Annulé** par {who}. Valo, ce sera pour une autre fois. Le frigo, lui, n'attendra pas. 🧊"
];

const flopTitles = [
  "🪑 Flop : la salle est vide",
  "🦗 Ambiance cricket",
  "🫥 Mais... il y a quelqu'un ?"
];

const flopLines = [
  "Seulement **{n}/{size}** présents. Les autres sont sûrement « en route ». Depuis 2019. 🚗",
  "**{n}/{size}** joueurs : c'est plus une party, c'est une réunion de copropriété. 📋",
  "**{n}/{size}** ! On aurait plus vite rempli un ascenseur en panne. 🛗",
  "Il manque du monde (**{n}/{size}**). Ils ont dû tomber sur une promo Steam. 🛒"
];

const reminders = [
  "Le match commence dans **{label}** ! C'est le moment de faire semblant d'avoir fini de manger. 🍝",
  "Plus que **{label}** ! Ton « j'arrive » de tout à l'heure, il est où ? 🚶",
  "**{label}** avant la game. Va chercher à boire, passe aux toilettes, et reviens. On t'attend. 🥤",
  "**{label}** avant le match ! Ceux qui n'ont pas voté : on voit que vous êtes là, hein. 👀"
];

const statsBefore = [
  "Photo avant la game ! On regardera ça après pour pleurer ensemble. 📸",
  "Le point de départ est posé. Les chiffres sont comme les cookies : on en veut plus à la fin. 🍪",
  "État des lieux avant le carnage. Que ceux qui montent lèvent la main (ils sont vraiment très peu). 🙋"
];

const statsAfter = [
  "Voici le bilan ! Toute ressemblance avec un bon niveau serait purement fortuite. 🧾",
  "Les chiffres sont tombés. Mention spéciale à celui qui dira « c'était un bon lobby ». 🎤",
  "Le bilan est là. Pour les réclamations, merci de remplir le formulaire 404. 📮"
];

const mvp = [
  "👑 MVP de la soirée : {name} avec **{acs} ACS**. Les autres peuvent applaudir, c'est gratuit. 👏",
  "👑 {name} a porté la squad avec **{acs} ACS**. Prévoir un massage du dos. 💆",
  "👑 {name} (**{acs} ACS**) a clairement installé un deuxième cerveau. 🧠"
];

const boulet = [
  "🥔 Mention « patate douce » : {name} (**{acs} ACS**). Il a fait de la figuration, et avec talent. 🎭",
  "🥔 {name} ferme la marche avec **{acs} ACS**. Il était sûrement en train de visiter la map. 🗺️",
  "🥔 {name} (**{acs} ACS**) : « C'est pas moi, c'est la souris. » 🖱️"
];

const voteAck = {
  sure: "🟢 Présent ! Et en plus tu as l'air content, c'est beau. ✨",
  maybe: "🟡 Un « peut-être »... traduction : « je regarde si y'a un truc sur Netflix ». 📺",
  if_last: "🟣 Joker en réserve : le Batman de la squad, on t'appelle si ça brûle. 🦇",
  backup: "🟠 Remplaçant noté ! Garde le téléphone allumé et les crampons à portée de main. ⚽",
  no: "🔴 Non ? Bon, on dira à tes agents que tu es « occupé ». 💼",
  remove: "🗑️ Vote effacé. On n'a rien vu, on n'a rien entendu. 🙈"
};

// ---------- Interaction replies (errors, confirmations) ----------
const msg = {
  guildOnly: "⛔ Cette commande ne marche que dans un serveur. « Pas en DM, frérot. »",
  guildOnlyShort: "⛔ Cette commande ne marche que dans un serveur.",
  channelRestricted: (mentions) => `⛔ **Channel Restricted:** Valobot commands are locked to ${mentions} on this server.`,
  channelRestrictedModal: "⛔ **Channel Restricted:** Valobot votes cannot be launched in this channel.",
  invalidTime: (time, withAutocomplete = false) =>
    `❌ **Invalid Match Time:** \`${time}\` could not be recognized.\n💡 **Allowed examples:** \`21:00\`, \`in 30m\`, \`in 1h\`, \`tomorrow 20:30\`, \`now\`${withAutocomplete ? ', or pick from the autocomplete suggestions' : ''}.`,
  createFailed: (detail) => `❌ Impossible de créer la session : ${detail}`,
  launchFailed: (detail) => `❌ Impossible de lancer la session : ${detail}`,
  internalError: "erreur interne.",
  sessionNotFound: "⚠️ Session not found or expired.",
  sessionNotFoundShort: "⚠️ Session not found.",
  voteOnCancelled: "🚫 Session annulée. Plus personne ne vote, « circulez y'a rien à voir ».",
  votingClosed: "🔒 Le match a déjà commencé, trop tard ! « You snooze, you lose » 😴",
  otherGuild: "⛔ Cette session appartient à un autre serveur.",
  voteRecorded: (ack) => `✅ Vote enregistré : ${ack}`,
  voteFailed: (err) => `❌ Impossible d'enregistrer ton vote : ${err}`,
  alreadyCancelled: "ℹ️ This session has already been cancelled.",
  cancelNotAllowed: (creatorId) => `⛔ Nope ! Seul <@${creatorId}> ou un admin peut annuler. « You shall not pass » 🧙`,
  cancelDone: "🛑 **Session annulée !** Le tampon CANCELLED est posé. « Et c'est le drame » 🎭",
  cancelFailed: (err) => `❌ Could not cancel session: ${err}`
};

// ---------- Messages posted in the channel ----------
const channel = {
  recruitHeaderPing: (pingText) => `🎮 **ÇA RECRUTE POUR VALO !** ${pingText}`,
  recruitHeaderSilent: (pingTarget) => `🎮 **ÇA RECRUTE POUR VALO !** *(Notifs : ${pingTarget === 'only_on_time' ? "juste à l'heure H" : 'silencieux, mode ninja'})*`,
  cancelledNotEnough: "🛑 **Session annulée** : pas assez de joueurs. « Et c'est le drame » 🎭",
  theHost: "l'hôte",
  matchStarted: "🏁 **MATCH LANCÉ** — les votes sont clos. « GG WP » 🤝",
  aPlayer: "Un joueur",
  defaultNote: "Competitive Stack",
  defaultNoteModal: "Valorant Stack",
  reminderTitle: (label) => `⏰ MATCH DANS ${label.toUpperCase()} — ON ATTEND TA RÉPONSE`,
  reminderLabelHours: (h) => `${h} hour(s)`,
  reminderLabelMinutes: (m) => `${m} minutes`,
  reminderDescription: (note, partyUnix, locked, size) =>
    `La session **"${note}"** démarre <t:${partyUnix}:R> !\n\n` +
    `🛡️ **Squad actuelle :** **${locked}/${size}**\n` +
    `⏰ **Début du match :** <t:${partyUnix}:t> (<t:${partyUnix}:F>)`,
  reminderFooter: (label) => `Valobot • Rappel automatique ${label} avant le match`,
  reminderButton: "👉 Aller voter, feignasse",
  flopContent: (n, size, mentions) => `💀 **FLOP DU MATCH** — seulement ${n}/${size} joueur(s) présent(s) à l'heure prévue. ${mentions}`,
  flopDescription: (note) => `La partie **${note}** devait commencer maintenant.`,
  flopFooter: "Valobot • Match flop"
};

// ---------- Session embed (title, fields, buttons) ----------
const embed = {
  titleCancelled: (n) => `🚫 [ANNULÉ] SESSION VALORANT ${n}-STACK`,
  titleStarted: (n) => `🏁 [MATCH LANCÉ] SESSION VALORANT ${n}-STACK`,
  titleLocked: (n) => `⏳ [DEADLINE PASSÉE] SESSION VALORANT ${n}-STACK`,
  titleOpen: (n) => `🎯 RECRUTEMENT VALORANT • [${n}-STACK]`,
  none: "None",
  header: (roleMention, creatorId, note) => `**Cible :** ${roleMention} • **Organisé par :** <@${creatorId}>\n**Mode / Note :** ${note}\n`,
  cancelledAuto: "\n> ⚠️ **SESSION ANNULÉE AUTOMATIQUEMENT** : pas assez de joueurs au moment du match.\n> « Et c'est le drame. »\n",
  cancelledBy: (who) => `\n> ⚠️ **SESSION ANNULÉE** par ${who}.\n> « Et c'est le drame. » Les votes sont terminés.\n`,
  started: "\n> 🏁 **Le match a commencé.** Les votes sont clos. « GG WP »\n",
  locked: "\n> ⏳ **Deadline dépassée**, mais les retardataires sont acceptés jusqu'au match. « Better late than never »\n",
  fieldStart: "⏰ Début du match",
  fieldDeadline: "⏳ Deadline des votes",
  hostSaid: (text) => `*(Hôte : ${text})*`,
  fieldSquad: "🛡️ Squad",
  squadValue: (n, size) => `**${n}/${size} en place**`,
  badgeHost: " *(Hôte)*",
  badgeFiller: " *(Bouche-trou)*",
  badgeBackup: " *(Remplaçant)*",
  freeSpotTeam1: (i) => `*[Place libre — « Il est où le ${i}ème ? »]*`,
  freeSpot: "*[Place libre]*",
  team1Name: (n, size) => `⚔️ ÉQUIPE 1 (${n}/${size})`,
  team1Empty: "*Personne... « C'est le désert »*",
  team2Name: (n, size) => `⚔️ ÉQUIPE 2 (${n}/${size})`,
  backups: (n) => `🎒 Banc de touche (${n})`,
  maybes: (n) => `🤔 Peut-être (${n}) 🐇`,
  ifLast: (n) => `⚡ Si dernier recours (${n})`,
  declined: (n) => `❌ Indispo / Lâches (${n})`,
  unresponsive: (n) => `👻 Aux abonnés absents (${n})`,
  footer: (id) => `Session ID: ${id} • Valobot by Nytuo`,
  btnSure: "Je suis chaud",
  btnMaybe: "Je tente (peut-être)",
  btnIfLast: "Si dernier recours",
  btnBackup: "Remplaçant",
  btnNo: "Nan, flemme",
  btnRemove: "Effacer mon vote",
  btnCancelled: "Annulé",
  btnCancel: "Annuler",
  btnResults: "Résultats",
  btnDashboard: "Dashboard web"
};

// ---------- Stats / results ----------
const stats = {
  footer: "Valobot • Données HenrikDev API • Non affilié à Riot Games",
  unknownRank: "*rang inconnu*",
  errRateLimited: (seconds) => `Trop de requêtes vers l'API de stats, réessaie dans ${seconds}s. « Doucement sur le clic » 🐢`,
  errUnauthorized: "La clé API de stats est invalide ou absente (admin du bot : vérifie `HENRIK_API_KEY`).",
  errUnavailable: "L'API de stats ne répond pas pour le moment. « Ça arrive aux meilleurs. » 🔧",
  notLinked: (userId) => `<@${userId}> — 🔗 pas lié (\`/valolink\`)`,
  beforeTitle: "📊 Avant la partie : état des lieux",
  whenDoneName: "Quand c'est fini",
  whenDoneValue: "Clique sur **📊 Résultats** sous le message de la session (ou tape `/valoresult`). Plusieurs parties dans la soirée ? Le bilan les additionne toutes.",
  resultTitle: "🏁 Bilan de la soirée",
  nobodyLinked: "Personne n'a lié son compte Riot. Tapez `/valolink riot_id:Pseudo#TAG` puis relancez le bilan. « Sans données, pas de gloire. » 🕳️",
  noGames: (allModes) =>
    `Aucune partie ${allModes ? '' : 'compétitive '}jouée ensemble détectée depuis le début de la session.${allModes ? '' : ' Pour inclure les autres modes : `/valoresult all:True`.'} Les parties mettent parfois une minute à apparaître : réessaie dans un instant. « Patience, jeune padawan. » 🧘`,
  gamesPlayed: (n) => `🎮 Parties jouées (${n})`,
  rankLabel: (text) => `Rang : ${text}`,
  noSquadGame: "*Pas de partie avec l'escouade.*",
  gamesLine: (g, w, l) => `Parties : **${g}** (${w}V-${l}D)`,
  kdaLine: (k, d, a, kda) => `K/D/A : **${k}/${d}/${a}** · KDA **${kda}**`,
  avgLine: (acs, adr, hs) => `ACS moy. : **${acs}** · ADR **${adr}** · HS **${hs}%**`,
  agentsField: "🎭 Agents joués",
  agentsValue: "Un portrait par partie, dans l'ordre. Bordure verte = victoire, rouge = défaite.",
  noStatsFor: "🔗 Pas de stats pour",
  noStatsForValue: (n) => `${n} joueur(s) sans compte lié. Utilise \`/valolink\` pour apparaître dans le prochain bilan.`,
  guildOnly: "⛔ Seulement dans un serveur.",
  notEnabled: "📊 Les stats ne sont pas activées sur ce bot (`HENRIK_API_KEY` manquante).",
  noSession: "🤷 Aucune session terminée trouvée ici. Le bilan est dispo une fois l'heure du match passée.",
  sessionCancelled: "🚫 Session annulée, pas de bilan à faire.",
  notStarted: "⏳ Le match n'a pas encore commencé. Reviens quand c'est fini !",
  notAllowed: "⛔ Seuls l'hôte et les joueurs de la session peuvent demander le bilan.",
  cooldown: (s) => `🐢 Un bilan vient d'être demandé, patiente ${s}s.`,
  failed: (text) => `❌ ${text}`,
  invalidRiotId: "❌ Riot ID invalide. Format attendu : `Pseudo#TAG` (ex. `Nytuo#EUW`). « Il manque le #, chef. »",
  accountNotFound: (name, tag, region) => `❌ Compte **${name}#${tag}** introuvable en région \`${region}\`. Vérifie l'orthographe et la région.`,
  linked: (label, region, url) => `✅ Compte lié : **${label}** (\`${region}\`). Tu apparaîtras dans les bilans de tes parties.\nProfil : ${url}\n*Retire-toi quand tu veux avec \`/valounlink\`.*`,
  unlinked: "🗑️ Compte Riot délié, tes données sont supprimées. « Parti sans laisser d'adresse. »",
  notLinkedInfo: "ℹ️ Aucun compte lié."
};

module.exports = {
  msg,
  channel,
  embed,
  stats,
  pick,
  recruitment,
  joined,
  locked,
  lockedSquad,
  cancelled,
  flopTitles,
  flopLines,
  reminders,
  statsBefore,
  statsAfter,
  mvp,
  boulet,
  voteAck
};
