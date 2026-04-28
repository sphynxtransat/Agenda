# Décisions du projet Agenda

## Structure

### 2026-04-28 — Séparation CSS/JS hors de index.html
CSS → `shared/web/style.css`, JS → `shared/web/app.js`, HTML → `shared/web/index.html`
Raison : le fichier unique de 1871 lignes rendait les diffs illisibles et les bugs difficiles à localiser.

---

## UI / UX

### 2026-04-28 — Note quotidienne : section fixe en bas de sidebar
Deux tentatives de note "card" flottante ou insérée dans l'état vide ont été revertées.
La version retenue est une section `<div class="note-section">` permanente sous `#taskList`.
Raison : les versions précédentes disparaissaient quand des tâches étaient ajoutées ou flashaient au render.

### 2026-04-28 — Carte "Espace léger" supprimée
La carte décorative affichée quand il n'y a pas de tâches a été retirée.
Remplacée par rien (zone vide) + section Note toujours visible en dessous.

### 2026-04-28 — backdrop-filter désactivé sur mobile
`backdrop-filter:blur()` retiré sur tous les éléments pour les appareils touch (`@media (hover:none) and (pointer:coarse)`).
Raison : forçait une recomposition GPU à chaque frame de scroll, causant lag et gel sur smartphone.

---

## Workflow

### 2026-04-28 — Workflow branche obligatoire
Toujours travailler sur une branche feature, jamais directement sur `main`.
`main` = toujours stable et déployable.
Raison : plusieurs régressions causées par des commits directs sur main avec trop de changements groupés.

### 2026-04-28 — Un commit = une chose
Commits atomiques : une feature ou un fix par commit.
Raison : les gros commits (ex: "Audit complet") sont impossibles à revenir en arrière chirurgicalement.
