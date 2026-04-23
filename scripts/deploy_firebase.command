#!/bin/bash
set -e

cd "$(dirname "$0")"
PROJECT_ROOT="$(cd .. && pwd)"
cd "$PROJECT_ROOT"

echo "Preparation du deploy Agenda..."

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI introuvable."
  echo "Installe-la avec: npm install -g firebase-tools"
  exit 1
fi

if [ ! -f ".firebaserc" ]; then
  echo "Creer .firebaserc puis renseigne ton project id Firebase."
  exit 1
fi

firebase deploy --only firestore:rules,hosting
