# MARONET 360 — application de gestion (version MVP)

Application web de gestion pour une entreprise de sécurité/gardiennage et de nettoyage : personnel, documents et échéances, clients et contrats, planning avec contrôle de couverture, pointage (manuel, QR code, validation superviseur), checklists de nettoyage, incidents, stocks, facturation simple, rentabilité estimée, préparation des éléments de paie.

Elle fonctionne comme un **serveur** (sur un PC, un mini-serveur ou un hébergement) auquel on accède par un **navigateur** : ordinateurs Windows, Mac, Linux, tablettes et téléphones Android/iPhone. Sur téléphone et ordinateur, elle peut être **installée comme une application** (PWA).

> ⚠️ Cette version est un **MVP** à valider avant tout usage réel (voir « Limites » et « Avant la mise en production »).

---

## 1. Lancer l'application

### Option A — avec Node.js (le plus simple)
1. Installez **Node.js 22.13 ou plus récent** (version LTS) : https://nodejs.org
2. Décompressez ce dossier, puis :
   - **Windows** : double-clic sur `start-windows.bat`
   - **Mac** : double-clic sur `Lancer MARONET 360.command` (si macOS le bloque : clic droit → Ouvrir)
   - **Linux** : `./start-mac-linux.sh`
3. Ouvrez **http://localhost:3000**.

Premier lancement : un compte `admin` est créé avec un **mot de passe temporaire aléatoire**, affiché dans la fenêtre et écrit dans `data/PREMIER_LANCEMENT.txt`. Connectez-vous, changez-le, puis **supprimez ce fichier**.

### Option B — avec Docker (serveur, Linux, NAS)
```
docker compose up -d
```
Les données sont conservées dans le volume `maronet_data`. Le mot de passe admin initial s'affiche avec `docker compose logs maronet`.

### Essayer avec des données de démonstration
Windows : `start-windows.bat demo` — Mac/Linux : `./start-mac-linux.sh demo` (ou `npm run demo`).
Cela crée **uniquement si la base est vide** des données **fictives** (employés « Exemple N », clients « Démo ») et 13 comptes de test, un par profil, mot de passe commun `Demo-Maronet-360` (identifiants : `admin`, `dg`, `rh`, `adm`, `resp.securite`, `resp.nettoyage`, `superviseur1`, `superviseur2`, `comptable`, `commercial`, `agent.securite`, `agent.nettoyage`, `auditeur`).
**Ne jamais utiliser ces comptes avec de vraies données** : repartez d'un dossier `data/` vide.

---

## 2. Utilisation sur téléphone, tablette, autres ordinateurs

- Le serveur affiche au démarrage son adresse sur le réseau local, par exemple `http://192.168.1.20:3000`. Les appareils connectés au **même Wi-Fi** s'y connectent avec leur navigateur. Autorisez le port 3000 dans le pare-feu si besoin.
- **Installation comme application** : les navigateurs n'autorisent l'installation (et la caméra pour scanner les QR codes) que sur une adresse **HTTPS** ou `localhost`. Pour un usage réel sur téléphones, placez l'application derrière **HTTPS** (par exemple un nom de domaine + Caddy/Nginx, ou un hébergement avec certificat), puis définissez `MARONET_TRUST_PROXY=1` et `MARONET_HTTPS=1`.
  Une fois en HTTPS : Android/Chrome → menu ⋮ → « Installer l'application » ; iPhone/Safari → Partager → « Sur l'écran d'accueil » ; Windows/Mac Chrome ou Edge → icône d'installation dans la barre d'adresse.
- Sans HTTPS, l'application reste utilisable dans le navigateur ; la saisie manuelle du code du poste remplace le scan.
- **Mode hors ligne (agents)** : prise de poste, fin de service, tâches cochées et déclaration d'incident sont mémorisées sur le téléphone si le réseau manque, puis envoyées automatiquement au retour (l'heure réelle est conservée, dans la limite de 48 h). La consultation hors ligne se limite au dernier accueil chargé.

## 3. Configuration (variables d'environnement)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` / `HOST` | port et interface d'écoute | 3000 / 0.0.0.0 |
| `MARONET_DATA` | dossier des données (base, fichiers, sauvegardes) | `./data` |
| `MARONET_TRUST_PROXY=1` | derrière un proxy inverse | non |
| `MARONET_HTTPS=1` | active HSTS (HTTPS obligatoire) | non |
| `MARONET_COOKIE_SECURE=1` | cookie de session « Secure » | auto si HTTPS |
| `MARONET_ADMIN_PASSWORD` | mot de passe admin initial imposé | aléatoire |

## 4. Sauvegardes
- Une sauvegarde automatique quotidienne est écrite dans `data/backups` (14 conservées).
- L'administrateur peut aussi télécharger une copie : Paramètres → Sauvegarde.
- Conservez des copies **hors du serveur**. Pour restaurer : arrêtez l'application et remplacez `data/maronet360.db` par la sauvegarde. Les pièces jointes sont dans `data/uploads` : copiez-les aussi.

## 5. Ce qui est inclus
Profils et droits (12 rôles, périmètres par site/activité, champs sensibles masqués selon le rôle) · employés, documents, formations, absences, assurances, suivi CNSS (suivi manuel) · clients, sites, contrats, alertes d'échéance · postes, planning, contrôle des conflits (chevauchement, absence validée, repos minimal, heures hebdomadaires, qualification), remplacement avec candidats · pointage manuel / QR / superviseur · checklists et tâches de nettoyage, contrôle qualité, incidents · équipements, consommables, mouvements de stock · factures, paiements, dépenses, rentabilité par contrat (estimation) · éléments variables de paie (préparation) · journal d'audit · export CSV · tableau de bord · accueil mobile des agents.

## 6. Limites (à lire)
- **Pas de calcul de paie** (salaires, cotisations, retenues) : seulement la préparation des heures et absences.
- **Pas de déclarations CNSS automatiques** ni d'intégration à un portail officiel : le suivi CNSS est une liste de démarches saisies à la main.
- Pas d'IA, pas de décision automatique sur des sanctions, pas de géolocalisation, pas d'envoi de SMS ou d'e-mails (les notifications sont internes à l'application).
- Les seuils (44 h/semaine, 11 h de repos, délais d'alerte…) sont des **valeurs indicatives modifiables** dans Paramètres, **à faire valider** par votre conseil juridique / RH. Ils produisent des avertissements, pas une garantie de conformité.
- La rentabilité est une **estimation de gestion**, pas une comptabilité.
- Une seule instance/serveur : pas de multi-sociétés, pas de haute disponibilité.

## 7. Avant la mise en production
1. Faites relire la sécurité (revue indépendante, test d'intrusion) et placez l'application derrière **HTTPS**.
2. Données personnelles : l'application traite des données sensibles (pièces d'identité, santé via arrêts maladie…). Votre conformité à la **loi 09-08 / CNDP** (déclaration/autorisation, information des employés, durées de conservation, sous-traitance d'hébergement) reste à établir par vous ; cette application ne la garantit pas.
3. Changez tous les mots de passe, supprimez `PREMIER_LANCEMENT.txt`, créez un compte par personne (pas de compte partagé).
4. Testez la restauration d'une sauvegarde.
5. Faites valider les règles de planning et les seuils par votre direction.

## 8. Technique
Node.js ≥ 22.13 (SQLite intégré, aucune compilation), Express, interface en JavaScript sans dépendance externe, service worker pour l'installation et le hors ligne. Tests : `npm test` (103 vérifications côté serveur : droits, périmètres, planning, pointage, finance, fichiers, audit).

## 9. Prototype en ligne depuis GitHub
GitHub héberge le code mais **ne peut pas exécuter** ce serveur (GitHub Pages = pages statiques uniquement). Deux façons de le rendre accessible :
- **GitHub Codespaces** (gratuit dans la limite du quota) : bouton *Code → Codespaces → Create*. L'application démarre avec les données fictives ; le port 3000 est ouvert en HTTPS (visibilité « Public » à régler dans l'onglet *Ports* pour partager le lien).
- **Render** (offre gratuite) : *New → Blueprint*, choisir le dépôt ; `render.yaml` fait le reste et donne une adresse HTTPS permanente (le service gratuit s'endort après inactivité, les données de démonstration sont réinitialisées).
⚠ Un prototype public avec comptes de démonstration (mot de passe connu) ne doit **jamais** contenir de vraies données.
