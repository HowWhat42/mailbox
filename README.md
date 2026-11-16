<img src="assets/icon.svg" width="64" height="64" alt="">

# Mailbox

Client mail + calendrier desktop (Windows / macOS / Linux). Pensé clavier d'abord, rapide, sans compte cloud intermédiaire : vos messages vont de votre serveur à votre machine, point.

## Démarrer

```bash
npm install
npm run dev
```

Node 22+ requis. Aucune compilation native : la base locale utilise `node:sqlite` intégré à Electron.

### Comptes Gmail / Google Workspace

La connexion Google passe par OAuth (navigateur système, PKCE, redirection loopback). Il faut un client OAuth à vous :

1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet.
2. Activer **Gmail API** et **Google Calendar API**.
3. Écran de consentement OAuth : type « Externe », ajoutez votre adresse comme utilisateur test.
4. Identifiants → Créer → **ID client OAuth** → type **Application de bureau**.
5. Copier `.env.example` en `.env` et renseigner `MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET`.

### Autres comptes (IMAP)

Adresse + mot de passe suffisent dans la plupart des cas : les serveurs sont détectés comme dans Thunderbird (autoconfig du fournisseur puis base ISPDB de Mozilla). Agenda : renseignez l'URL CalDAV (Nextcloud, Fastmail, Infomaniak, Radicale…) dans les réglages du compte.

## Raccourcis

| Touche | Action |
| --- | --- |
| `Ctrl K` | Palette de commandes |
| `J` / `K` | Conversation suivante / précédente |
| `E` | Archiver |
| `#` / `Suppr` | Supprimer |
| `S` | Suivre / ne plus suivre |
| `U` | Lu / non lu |
| `!` | Indésirable |
| `R` / `A` / `F` | Répondre / répondre à tous / transférer |
| `C` | Nouveau message |
| `/` | Rechercher |
| `Ctrl Entrée` | Envoyer |
| `G` puis `I` `S` `T` `D` `C` | Réception, suivis, envoyés, brouillons, calendrier |
| Calendrier : `T` `W` `M` `N` `←` `→` | Aujourd'hui, semaine, mois, nouvel événement, navigation |

## Ce qui est là

- Boîte de réception unifiée multi-comptes, conversations groupées, couleur par compte.
- Synchronisation IMAP incrémentale + IDLE (nouveaux messages en direct, notifications système).
- Recherche plein texte locale instantanée (SQLite FTS5, insensible aux accents).
- Lecture hors ligne des messages déjà ouverts.
- HTML des mails isolé : DOMPurify + iframe sans scripts + CSP ; images distantes bloquées par défaut (pixels espions).
- Éditeur riche, pièces jointes, signatures, réponses avec citation.
- Calendrier semaine / mois : Google Agenda et CalDAV, récurrences, création / modification / suppression.
- Thème sombre et clair. Mots de passe et jetons chiffrés par le trousseau de l'OS (`safeStorage`).

## Limites connues

- Première synchro : les 400 messages les plus récents par dossier. La recherche ne couvre que ce qui est en local.
- Gmail « Tous les messages » n'est pas synchronisé (doublons des libellés) ; l'archivage y déplace bien les messages.
- Pas encore de brouillons enregistrés sur le serveur ni d'autocomplétion des contacts.
- CalDAV : modifier une occurrence d'un événement récurrent n'est pas pris en charge ; la suppression supprime la série.
- Pas d'installeur packagé pour l'instant.

## Tests

```bash
npm run typecheck
npm run test:e2e            # boîte jetable Ethereal : synchro, threads, PJ, envoi, archive, recherche
npm run test:e2e:calendar   # nécessite un Radicale local (voir l'en-tête du fichier)
```

## Architecture

```
src/main/        process Electron : SQLite, IMAP (imapflow), SMTP (nodemailer), OAuth Google, CalDAV (tsdav + ical.js)
src/preload/     pont IPC typé exposé en window.mailbox
src/shared/      contrat de types partagé main ⇄ UI
src/renderer/    React 19 + Tailwind 4 + zustand
tests/           tests E2E Playwright pilotant l'app réelle
```
