# Prozessanalyse Vertrieb – UNICUM TV

**Quelle:** Gesprächstranskript vom 22.09.2026. Das Transkript ist maschinell erzeugt und kann Fehler enthalten.

## Artefakte

| Datei | Inhalt |
|---|---|
| `ist-prozess.workflow.html` | Belegter Ist-Prozess: Akquise, Pflege warmer Leads sowie Anfrage bis Angebot / Rechnung. |
| `ziel-prozess.workflow.html` | Vorschlag für einen kapazitätsgesteuerten Zielprozess mit verpflichtender menschlicher Kontrolle. |
| `*.json` | Validierte Archify-Quellen der jeweiligen interaktiven HTML-Datei. |

## Befund: belegte Fakten

### Geschäftsprozesse
1. **Neukundengewinnung:** Passende Online-Quellen (besonders studentische Job- und Karrieremessen) werden manuell recherchiert. Unternehmensname, Ansprechpartner und E-Mail-Adresse werden in Excel übernommen; anschließend erfolgen E-Mail- bzw. Serienmailings.
2. **Bestandskunden / warme Leads:** Kontakte mit signalisiertem Interesse und Wiedervorlagen liegen in **weclapp**. Ansprache reicht von Serienmail-ähnlich bis individuell; Zeitpunkt und Menge werden bewusst nach Tageskapazität gesteuert.
3. **Angebotserstellung:** Bei konkreten Anfragen werden Standorte / Werbeträger anhand von u. a. Stadt, Fachbereich, Format, Kontaktzahl, Belegbild und Einkaufskonditionen selektiert. Komplexe Fälle dauern bis etwa ein bis zwei Stunden.
4. **Formeller Abschluss:** Ein formelles Angebot kann in **DATEV** erstellt und von dort in Auftragsbestätigung bzw. Rechnung überführt werden.

### Rollen
- **Vertrieb / Alex:** Neurecherche, Mailing, Follow-ups, Angebotsarbeit, Reaktion auf Anfragen.
- **Bestandskunden- / Partnerpflege:** Pflege eines langjährigen Partnerpools und Information von Vertriebspartnern / Mediaagenturen.
- **Kunde / potenzieller Kunde:** Reagiert, fordert späteren Kontakt oder stellt eine konkrete Anfrage.
- **Vertriebspartner / Mediaagenturen:** Liefern einen Teil der Aufträge; direkter Einfluss ist begrenzt.

### Genannte Systeme und Werkzeuge
- **weclapp:** Kontaktdatenpflege und Wiedervorlagen; nicht alle Funktionen werden genutzt.
- **Excel:** Recherchelisten sowie teils Absagen / Nichtantworten.
- **Outlook / Rebo:** Mailings bzw. Serienversand.
- **DATEV:** formelles Angebot, Auftragsbestätigung und Rechnung.
- **Standort- / Werbeträgerdaten:** Datenbestand zu rund 900 Werbeträgern; konkreter Speicherort nicht genannt.

### Probleme, Übergaben und Wartestatus
- Manuelles Kopieren aus Online-Quellen in Excel.
- Keine im Transkript belegte zentrale Verwaltung aller Leads; Daten sind mindestens zwischen Excel und weclapp getrennt.
- Hohe zeitliche Varianz bei Standortselektionen.
- Lange Nachfragezyklen: Häufig „später“ statt unmittelbarer Bedarf.
- Opt-outs müssen gespeichert und berücksichtigt werden.
- Ein Mailing mit mehr als 500 E-Mails führte laut Gespräch zu einer zeitweisen Microsoft-Sperre.
- Frühere KI-/Dienstleisterkampagnen scheiterten u. a. an ungeeignetem Adresspool, falschem Ton und unpassendem Versandzeitpunkt.

## Vorgeschlagene Automatisierungen – keine Ist-Fakten

1. **KI-gestützte, quellengebundene Recherche:** Freigegebene Quellen durchsuchen, Kontaktinformationen extrahieren und strukturierte Vorschläge erzeugen. Jede Aufnahme bleibt menschlich freigabepflichtig.
2. **Kapazitätsgesteuerte Entwurfswarteschlange:** Der Vertrieb wählt morgens selbst Anzahl und Kontakte aus; die KI erstellt ausschließlich Entwürfe. Versand erfolgt erst nach Ton-, Inhalt- und Mengenfreigabe.
3. **Selektionsassistent für Angebote:** Auf Basis explizit gepflegter Kriterien einen nachvollziehbaren Vorschlag erzeugen. Preis, Konditionen, Eignung und Kundenmehrwert bleiben beim Vertrieb.
4. **Kontakt- und Sperrlogik:** Ein verbindliches Datenmodell für Quelle, Status, letzter Kontakt, Wiedervorlage und Opt-out. Umsetzung erst nach Klärung, welches System führend sein soll.

## Annahmen und offene Punkte

- **Keine Schnittstellen behauptet:** Zwischen Excel, weclapp, Outlook / Rebo und DATEV wurde keine API, Import-/Export-Routine oder andere technische Integration genannt.
- **Systemführerschaft offen:** Ob weclapp erweitert, ersetzt oder nur ergänzt werden soll, ist nicht entschieden.
- **Datenbasis für Angebotsassistenz offen:** Speicherort, Feldstruktur, Aktualität und Zugriffsrechte der Standort-, Werbeträger- und Einkaufskonditionsdaten sind zu klären.
- **Compliance / Zuständigkeit offen:** Rechtsgrundlage für Ansprache, Opt-out-Prozess, Datenquellen, Dublettenprüfung, Versandlimits und Freigaberechte sind vor Implementierung verbindlich festzulegen.

## Priorisierung

**Phase 1 – hoher Hebel, geringes Risiko:** Menschlich kontrollierte Mail-Entwürfe aus weclapp-Wiedervorlagen; Tagesmenge wird vom Vertrieb gesetzt.

**Phase 2 – Skalierung ohne Qualitätsverlust:** Quellengebundene Recherche mit Prüfqueue, Dubletten- und Opt-out-Prüfung.

**Phase 3 – datenabhängig:** Angebotsselektionsassistent, sobald der Werbeträgerdatenbestand inklusive Konditionen und Auswahlkriterien verlässlich strukturiert ist.
