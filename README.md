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

Adresse + mot de passe suffisent dans la plupart des cas : les serveurs sont détectés comme dans Thunderbird (autoconfig du fournisseur puis base ISPDB de Mozilla).

### Agendas

Calendrier › **Ajouter un agenda**, indépendamment des comptes mail :

- **Google Agenda** : tous les agendas d'un compte Google, lecture et écriture (les comptes Gmail ajoutés en mail apportent aussi les leurs).
- **CalDAV** : iCloud (mot de passe pour app), Nextcloud, Fastmail, Infomaniak, Radicale…
- **Abonnement .ics** : agenda Outlook / Office 365 publié (Paramètres › Calendrier › Calendriers partagés › Publier), jours fériés, plannings partagés. Lecture seule.

Microsoft 365 en lecture-écriture (Graph) n'est pas encore pris en charge : il demande une application Azure AD.

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
| `V` | Déplacer vers un dossier |
| `X` | Cocher la conversation |
| `Z` | Annuler la dernière action |
| `Ctrl \` | Afficher / masquer la barre latérale |
| `R` / `A` / `F` | Répondre / répondre à tous / transférer |
| `C` | Nouveau message |
| `/` | Rechercher |
| `Ctrl Entrée` | Envoyer |
| `G` puis `I` `S` `T` `D` `C` | Réception, suivis, envoyés, brouillons, calendrier |
| Calendrier : `T` `D` `W` `M` `A` | Aujourd'hui, jour, semaine, mois, agenda |
| Calendrier : `N` `←` `→` | Nouvel événement, période précédente / suivante |

## Ce qui est là

- Boîte de réception unifiée multi-comptes, conversations groupées, couleur par compte.
- Synchronisation IMAP incrémentale + IDLE (nouveaux messages en direct, notifications système).
- Recherche plein texte locale instantanée (SQLite FTS5, insensible aux accents).
- Lecture hors ligne des messages déjà ouverts.
- HTML des mails isolé : DOMPurify + iframe sans scripts + CSP ; images distantes bloquées par défaut (pixels espions).
- Éditeur riche, pièces jointes, signatures, réponses avec citation.
- Calendrier façon Outlook : plusieurs agendas (Google, CalDAV, abonnements .ics) superposés, vues jour / semaine / mois / agenda, mini-calendrier, couleur par agenda.
- Réunions en ligne détectées (Teams, Meet, Zoom, Webex, Jitsi…) avec bouton **Rejoindre** sur l'événement, dans l'aperçu, la vue agenda et l'encart « prochain événement ».
- Invitations : participants et leurs réponses, Accepter / Provisoire / Refuser (Google et CalDAV).
- Rappels dans une fenêtre flottante toujours au premier plan (même au-dessus d'une app en plein écran), sans voler le focus : Rejoindre, Rappeler dans 5 / 15 min, Ignorer. Délai de l'événement, sinon celui des réglages ; les visios sonnent aussi au début.
- Fonctionne en arrière-plan depuis la barre des tâches (option), lancement au démarrage (version installée).
- Brouillons enregistrés automatiquement sur le serveur ; archiver, supprimer et abandonner un brouillon s'annulent (`Z`) pendant 5 s.
- Destinataires en pastilles avec autocomplétion, déplacement vers un dossier, sélection multiple, menu contextuel.
- Interface responsive : sidebar en rail puis en tiroir, un seul panneau sous 1100 px, calendrier en 3 jours sur fenêtre étroite.
- Thème « nuit » (nébuleuse pixélisée générée au lancement) et thème clair. Mots de passe et jetons chiffrés par le trousseau de l'OS (`safeStorage`).

## Limites connues

- Première synchro : les 400 messages les plus récents par dossier. La recherche ne couvre que ce qui est en local.
- Gmail « Tous les messages » n'est pas synchronisé (doublons des libellés) ; l'archivage y déplace bien les messages.
- CalDAV : modifier une occurrence d'un événement récurrent n'est pas pris en charge ; la suppression et la réponse à une invitation s'appliquent à toute la série.
- Rappels : pas pour les événements « toute la journée ».
- Pas d'installeur packagé pour l'instant.

## Tests

```bash
npm run typecheck
npm run test:e2e            # boîte jetable Ethereal : synchro, threads, PJ, envoi, archive, recherche
npm run test:e2e:calendar   # Radicale local : sources CalDAV + .ics, récurrences, réponse, rappel flottant, Rejoindre
npm run test:e2e:responsive # redimensionne la fenêtre de 1440 à 480 px, vérifie l'absence de débordement
```

## Architecture

```
src/main/        process Electron : SQLite, IMAP (imapflow), SMTP (nodemailer), OAuth Google, CalDAV (tsdav + ical.js)
src/preload/     pont IPC typé exposé en window.mailbox
src/shared/      contrat de types partagé main ⇄ UI
src/renderer/    React 19 + Tailwind 4 + zustand
tests/           tests E2E Playwright pilotant l'app réelle
```
