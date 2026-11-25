# Nouveautés

Écrites pour les personnes qui utilisent Mailbox. La section « À venir » devient la prochaine version au moment de `pnpm release`, et c'est elle qui s'affiche dans l'app quand la mise à jour est prête.

## À venir

- **Copier une image** d’un message par un clic droit, pour la coller ailleurs.
- **Enregistrer un message en PDF** : bouton dans l’en-tête de chaque message, avec l’expéditeur, les destinataires, la date et l’historique cité.
- **Copier une adresse en un clic droit** : sur l’expéditeur, les destinataires, les participants ou une adresse écrite dans le texte d’un message. Le nom et l’adresse de l’en-tête d’un message se sélectionnent aussi à la souris.

## 0.2.5 — 23 novembre 2026

- **Comptes Microsoft sur Linux** : la connexion Outlook, Hotmail ou Microsoft 365 fonctionne dans le snap et le flatpak.
- **Suppressions en rafale** : supprimer ou archiver plusieurs messages à la suite ne les fait plus réapparaître dans la boîte de réception.

## 0.2.4 — 19 novembre 2026

- **Notifications cliquables** : cliquer sur la notification d’un nouveau message ouvre ce message ; quand elle en annonce plusieurs, elle ouvre la boîte de réception.

## 0.2.3 — 19 novembre 2026

- **Mises à jour plus rapides** : Mailbox cherche une nouvelle version toutes les 15 minutes au lieu de toutes les 4 heures.

## 0.2.2 — 19 novembre 2026

- **Envoi plus rapide** : la fenêtre se ferme dès que le message est parti ; le rangement dans « Envoyés » et la suppression du brouillon se font ensuite, en arrière-plan.
- **Signatures avec images** : les images collées dans une signature (ou citées dans une réponse) sont jointes au message au lieu d’être recopiées dans le texte. Le message est plus léger et les images s’affichent aussi dans Gmail et Outlook.
- **Brouillons plus discrets** : l’enregistrement automatique ne renvoie plus le brouillon quand rien n’a changé.
- **Rappels d’événements** : les boutons de la carte restent sur une seule ligne, et la pile de rappels peut être déplacée à la souris ; elle reste là où vous l’avez posée jusqu’à sa fermeture.

## 0.2.1 — 19 novembre 2026

- **Toutes les nouveautés d’un coup** : si vous avez plusieurs versions de retard, « Voir les nouveautés » montre les notes de chacune, de la plus récente à la vôtre.
- **Mises à jour plus visibles** : une notification système annonce la nouvelle version (un clic ouvre ses nouveautés), et la barre latérale suit déjà son téléchargement.

## 0.2.0 — 19 novembre 2026

- **Mailbox 0.2** : cette version regroupe les nouveautés des 0.1.10 et 0.1.11, l’accès IA (serveur MCP local, dans Réglages › Accès IA), les comptes Outlook, Hotmail et Microsoft 365 connectés via le navigateur, et Mailbox sur Linux.

## 0.1.11 — 19 novembre 2026

- **Comptes Outlook, Hotmail et Microsoft 365** : Microsoft n’accepte plus le mot de passe pour lire ses mails depuis une autre application. Choisissez « Outlook, Hotmail ou Microsoft 365 » dans Ajouter un compte et connectez-vous dans le navigateur.

## 0.1.10 — 19 novembre 2026

- **Mailbox sur Linux** : une version pour Ubuntu et les autres distributions, en snap et en flatpak, est disponible au téléchargement. Les nouvelles versions y sont annoncées, à télécharger depuis la page de la version.
- **Accès IA** : un assistant comme Claude peut lire vos mails et votre agenda, écrire des brouillons ou classer vos conversations, via un serveur MCP local à activer dans Réglages › Accès IA. Désactivé par défaut, protégé par un jeton secret, limité à cet ordinateur ; chaque envoi demandé par l'IA attend votre confirmation, et un journal montre tout ce qu'elle a fait.

## 0.1.9 — 18 novembre 2026

- **Mailbox sur Mac** : une version pour macOS (Apple Silicon et Intel) est disponible au téléchargement. Elle n’est pas signée : au premier lancement, autorisez-la dans Réglages Système › Confidentialité et sécurité. Les nouvelles versions y sont annoncées, à télécharger depuis la page de la version.

## 0.1.8 — 18 novembre 2026

- Clic droit dans un message : ouvrir ou copier un lien, écrire à une adresse e-mail, copier le texte sélectionné ou l’adresse d’une image.
- Bouton **Relever le courrier** en haut de la liste (ou F5) pour vérifier tout de suite l'arrivée d'un message.
- La liste ne vous ramène plus au message ouvert quand vous remontez et qu'elle se met à jour.
- Choisissez où s'affichent les rappels d'agenda : en haut, au centre ou en bas de l'écran, à gauche, au milieu ou à droite (Réglages › Notifications).

## 0.1.7 — 17 novembre 2026

- Répondre Oui, Non ou Peut-être dans une invitation Google envoie la réponse depuis Mailbox, sans ouvrir Google Agenda, quand l'agenda invité est connecté.
- Un rappel d'agenda qui sonne moins de 15 minutes avant propose « Au début » plutôt que « 15 min », et un rappel reporté revient pile à l'heure.
- Un nouveau mail arrivé pendant une synchronisation est pris en compte tout de suite, avec sa notification, au lieu d'attendre plusieurs minutes.
- Certains messages restaient tassés sur quelques lignes avec leur propre barre de défilement : ils s'affichent maintenant en entier.
- Le sélecteur de libellés ouvert avec L ou depuis le menu s'affiche sous son bouton, plus dans le coin en haut à gauche.

## 0.1.6 — 16 novembre 2026

- Les grands vides qui pouvaient apparaître dans la liste des messages, au-dessus de « Aujourd'hui » ou « Ce mois-ci », ont disparu.
- Les sélecteurs de couleur et de libellés n'ont plus de double cadre.

## 0.1.5 — 16 novembre 2026

### Les mails s'ouvrent tout de suite

Les messages récents sont téléchargés pendant la synchronisation : les ouvrir ne demande plus d'attendre le serveur (environ 0,1 s au lieu de 2 s). Les petits mails se lisent même hors ligne.

### Modèles de messages

Chaque compte peut avoir ses modèles : objet, destinataires et texte prêts à l'emploi, avec des champs comme `{{Prénom}}` demandés au moment de l'insérer. Bouton **Modèles** dans le composeur, ou **Enregistrer ce message comme modèle**. À gérer dans Réglages › votre compte › Modèles.

### Signatures en HTML

Collez le code d'un générateur de signature : il est affiché tel quel, avec un aperçu dans les réglages. Changer le compte d'envoi change aussi la signature.

### Libellés

Les libellés Gmail et les étiquettes des autres logiciels (Thunderbird…) apparaissent sur les messages. Ajoutez-en ou retirez-en avec **L**, le bouton Libellés du lecteur ou le clic droit ; un nouveau se crée en tapant son nom.

### Dossiers

- Glissez une conversation sur un dossier pour l'y ranger.
- Les sous-dossiers s'affichent sous leur dossier parent.
- Épinglez vos dossiers favoris en haut de la barre latérale (clic droit › Ajouter aux favoris).
- Créez un dossier ou un sous-dossier directement depuis Mailbox.

### Agenda

**Ajouter une visio Google Meet** à la création d'un événement sur un agenda Google : le lien et le bouton Rejoindre sont prêts dès l'enregistrement.

### Et aussi

- Notifications, Invitations et Newsletters restent en haut de la boîte de réception.
- Un vrai sélecteur de couleur pour l'accent et la couleur de chaque compte.
- Les lignes de la liste ne se chevauchent plus, quelle que soit la taille de police de Windows.
- Les champs de saisie ont un contour de focus plus net.

## 0.1.4 — 16 novembre 2026

- L'adresse de chaque compte s'affiche sous son nom, et les dossiers sont rangés par compte.
- La barre latérale et la liste des messages se redimensionnent en glissant leur bord.
- « Toujours afficher » les images distantes depuis le bandeau d'un message.
- Le dossier Important de Gmail n'encombre plus la liste des dossiers.
- Le logo apparaît dans la barre de titre.

## 0.1.3 — 16 novembre 2026

- Connexion Google (Gmail et Google Agenda).

## 0.1.2 — 16 novembre 2026

- Première version publiée, avec les mises à jour automatiques.
