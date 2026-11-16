// techniques.js - Hengitystekniikoiden kirjasto ja ohjeet

export const TECHNIQUES = {
  box: {
    id: 'box',
    name: 'Box Breathing',
    icon: '⬜',
    rhythmLabel: '4 – 4 – 4 – 4 s',
    defaultRounds: 6,
    phases: {
      inhale: 4,
      holdIn: 4,
      exhale: 4,
      holdOut: 4
    },
    instructions: {
      short: 'Tasainen nelivaiheinen rytmi keskittymiseen ja stressin katkaisuun.',
      benefits: 'Rauhoittaa autonomista hermostoa ja selkeyttää ajatusta paineen alla.',
      howTo: 'Istu ryhdikkäästi, hengitä nenän kautta ja pidä hartiat rentoina.',
      avoid: 'Lopeta jos tunnet huimausta. Älä pakota pidätyksiä.'
    }
  },
  relax478: {
    id: 'relax478',
    name: '4–7–8 Rauhoitus',
    icon: '🌙',
    rhythmLabel: '4 – 7 – 8 s',
    defaultRounds: 6,
    phases: {
      inhale: 4,
      holdIn: 7,
      exhale: 8,
      holdOut: 0
    },
    instructions: {
      short: 'Pidennetty uloshengitys palautumiseen ja nukahtamisen tueksi.',
      benefits: 'Aktivoi parasympaattista hermostoa ja laskee sykettä tehokkaasti.',
      howTo: 'Hengitä kevyesti sisään nenästä, pidätä rauhassa ja puhalla pitkään ulos.',
      avoid: 'Jos 7 sekunnin pidätys tuntuu liian pitkältä, aloita lyhyemmällä rytmillä.'
    }
  },
  buteyko: {
    id: 'buteyko',
    name: 'Buteyko',
    icon: '🌬️',
    rhythmLabel: '3 – 0 – 4 – 4 s',
    defaultRounds: 8,
    phases: {
      inhale: 3,
      holdIn: 0,
      exhale: 4,
      holdOut: 4
    },
    instructions: {
      short: 'Kevyt nenähengitys ja hallittu tauko uloshengityksen jälkeen.',
      benefits: 'Tukee CO₂-sietokykyä, nenähengitystä ja rauhallista hengitysmallia.',
      howTo: 'Hengitä mahdollisimman hiljaa ja kevyesti vain nenän kautta.',
      avoid: 'Älä venytä pidätystä epämukavaksi — pidä tauko rentona.'
    }
  },
  tummo: {
    id: 'tummo',
    name: 'Tummo / Tasarytmi',
    icon: '🔥',
    rhythmLabel: '6 – 2 – 6 – 2 s',
    defaultRounds: 8,
    phases: {
      inhale: 6,
      holdIn: 2,
      exhale: 6,
      holdOut: 2
    },
    instructions: {
      short: 'Syvä ja vakaa hengitysrytmi sisäisen lämmön ja fokuksen nostamiseen.',
      benefits: 'Parantaa kehotietoisuutta, keskittymistä ja stressinsietoa.',
      howTo: 'Vedä syvään nenän kautta palleaan, lyhyt vakaa pito ja hallittu uloshengitys.',
      avoid: 'Pidä intensiteetti hallittuna ja tee harjoitus istuen tai maaten.'
    }
  }
};

export function getTechniqueById(id) {
  return TECHNIQUES[id] || TECHNIQUES.box;
}
