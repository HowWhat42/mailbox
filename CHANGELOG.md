# Nouveautés

Écrites pour les personnes qui utilisent Mailbox. La section « À venir » devient la prochaine version au moment de `pnpm release`, et c'est elle qui s'affiche dans l'app quand la mise à jour est prête.

## À venir

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
