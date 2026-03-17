# Bumble Encounters Vote Viewer

Extension Chrome MV3 qui fonctionne uniquement sur `bumble.com`.

## Ce qu'elle fait

- intercepte les réponses `mwebapi.phtml?SERVER_GET_ENCOUNTERS`
- stocke le profil courant et les profils suivants renvoyés par Bumble
- compare le `name` + `age` de la réponse avec :
  - `span.encounters-story-profile__name`
  - `span.encounters-story-profile__age`
- affiche à côté de l'âge :
  - `has_user_voted`
  - `match_message` si `has_user_voted === true` et si le message existe

## Installation

1. Ouvre `chrome://extensions`
2. Active le mode développeur
3. Clique sur `Charger l'extension non empaquetée`
4. Sélectionne ce dossier
5. Ouvre Bumble Web et recharge la page

## Fichiers

- `manifest.json` : configuration de l'extension
- `page-hook.js` : interception de `fetch` et `XMLHttpRequest` dans le contexte de la page
- `content.js` : rapprochement DOM/API et affichage du badge
