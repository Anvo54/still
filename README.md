# Still — Hengitys & Suorituskyky

Rauhoittava, minimalistinen ja ilmainen verkkosovellus hengityksen tutkimiseen, suorituskyvyn kehittämiseen ja sykkeen hallintaan.

## Ominaisuudet

- **Harjoitusmuodot**:
  - ⏱️ **Ajastettu tahti**:
    - 🐢 **Hidas**: ~4.8 s / sykli (2.4s sisään / 2.4s ulos) — rentouttava ja syvä
    - 🌊 **Keskivauhti**: ~3.4 s / sykli (1.7s sisään / 1.7s ulos) — tasainen perustahti
    - ⚡ **Nopea**: ~2.4 s / sykli (1.2s sisään / 1.2s ulos) — dynaaminen ja energinen
  - 🎤 **Kuuntelutila (Oma tahti)**:
    - Sovellus kuuntelee mikrofonilla käyttäjän hengitystä reaaliaikaisesti ilman raskaita ML-malleja (Web Audio DSP + kaistanpäästösuodatin 800–3200 Hz).
    - Automaattinen 2.5s huoneen taustamelun kalibrointi alussa.
    - Säädettävä herkkyys (Matala, Normaali, Korkea).
    - Ympyrä reagoi orgaanisesti hengityksen äänenvoimakkuuteen.
    - Laskee toistot automaattisesti.
- **Suomenkielinen puheohjaus (Web Speech API)**:
  - Sanoo toistot ("Viisi jäljellä", "Viimeinen hengitys").
  - Tavoitteen täyttyessä ohjeistaa: *"30 täynnä. Päästä ilma ulos ja pidätä."*
  - Ohjaa palautushengityksen: *"Ota syvä henki sisään ja pidätä 15 sekuntia."*
  - Toimii suoraan selaimessa ilman ulkoisia API-kutsuja tai kustannuksia.
- **Räätälöitävät hengitys- ja kierrosmäärät**:
  - Hengityksiä kierroksella: pikanapit (20, 30, 40) tai vapaa säätö (+/-)
  - Kierrosten määrä: pikanapit (2, 3, 4) tai vapaa säätö (+/-)
- **Interaktiivinen retentiovaihe (Retention hold)**:
  - Käynnistyy automaattisesti viimeisen uloshengityksen jälkeen
  - Sekuntikello mittaa retentioaikaa tarkasti reaaliajassa
  - Iso, selkeä **"Valmis / Ota henkeä"** -painike (tai välilyönti tietokoneella)
- **Palautushengitys (Recovery breath)**:
  - 15 sekunnin syvä sisäänhengityksen pito retentiovaiheen jälkeen
  - Visuaalinen alaspäinlaskuri ja äänimerkki kun 15s on kulunut
  - Mahdollisuus ohittaa tai kytkeä pois asetuksista
- **Ääniohjaus & Synteesi**:
  - Sisäänrakennetut harmoniset äänet Web Audio API:lla (nouseva ääni sisäänhengitykselle, laskeva ääni uloshengitykselle, syvä gongi retentiolle, kirkkaat kellot palautukselle)
  - Ei ulkoisia mp3-latauksia, toimii 100% offline
  - Mykistyskytkin yläpalkissa
- **Yhteenveto & Tilastot**:
  - Jokaisen kierroksen retentioajat listattuna
  - Paras kierros korostettuna
  - Kokonaiskesto ja hengitysten kokonaismäärä
- **Screen Wake Lock API**:
  - Estää näytön sammumisen puhelimella tai tabletilla harjoituksen aikana

## Testit

Aja yksikkötestit:

```bash
bun test
```
