/* =========================================================
   POKÉDEX LAB OS · GATEWAY + ARENA ELEMENTAL ANIMADA
   ========================================================= */

const POKEAPI_BASE = "https://pokeapi.co/api/v2";
const PAGE_LIMIT = 12;

/**
 * 1. API GATEWAY & CACHE EM MEMÓRIA
 */
class LabApiGateway {
  constructor() {
    this.cache = new Map();
    this.simulateOffline = false;
  }

  async get(url) {
    if (this.simulateOffline) {
      throw new Error("HTTP 503 · Falha simulada no API Gateway.");
    }

    if (this.cache.has(url)) {
      return { data: this.cache.get(url), source: "CACHE" };
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    this.cache.set(url, data);
    return { data, source: "API" };
  }
}

/**
 * 2. MICROSSERVIÇOS DO DOMÍNIO
 */
class CatalogService {
  constructor(gateway) {
    this.gateway = gateway;
    this.typeIndex = new Map();
  }

  async getPage(page = 1, type = "all") {
    const safePage = Math.max(1, page);

    if (type === "all") {
      const offset = (safePage - 1) * PAGE_LIMIT;
      const { data } = await this.gateway.get(
        `${POKEAPI_BASE}/pokemon?limit=${PAGE_LIMIT}&offset=${offset}`
      );
      const totalPages = Math.max(1, Math.ceil(data.count / PAGE_LIMIT));
      const items = await Promise.all(
        data.results.map(async (r) => (await this.gateway.get(r.url)).data)
      );
      return { items, totalPages, currentPage: safePage };
    }

    if (!this.typeIndex.has(type)) {
      const { data } = await this.gateway.get(`${POKEAPI_BASE}/type/${type}`);
      this.typeIndex.set(
        type,
        data.pokemon.map((p) => p.pokemon)
      );
    }

    const full = this.typeIndex.get(type);
    const totalPages = Math.max(1, Math.ceil(full.length / PAGE_LIMIT));
    const currentPage = Math.min(safePage, totalPages);
    const slice = full.slice((currentPage - 1) * PAGE_LIMIT, currentPage * PAGE_LIMIT);
    const items = await Promise.all(
      slice.map(async (r) => (await this.gateway.get(r.url)).data)
    );
    return { items, totalPages, currentPage };
  }

  async getByQuery(query) {
    const clean = String(query).trim().toLowerCase();
    return this.gateway.get(`${POKEAPI_BASE}/pokemon/${encodeURIComponent(clean)}`);
  }

  async getRandom() {
    const randomId = Math.floor(Math.random() * 1025) + 1;
    return this.getByQuery(randomId);
  }
}

class SpeciesStatsService {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async getEnrichedSpecies(speciesUrl) {
    const { data: species } = await this.gateway.get(speciesUrl);

    const genus =
      species.genera.find((g) => g.language.name === "pt") ||
      species.genera.find((g) => g.language.name === "en");

    let evolutions = [];
    if (species.evolution_chain?.url) {
      const { data: evoData } = await this.gateway.get(species.evolution_chain.url);
      evolutions = this.extractChain(evoData.chain);
    }

    return {
      genus: genus ? genus.genus : "Espécie Desconhecida",
      captureRate: species.capture_rate,
      evolutions,
    };
  }

  extractChain(node, out = []) {
    if (!node) return out;
    out.push(node.species.name);
    if (Array.isArray(node.evolves_to)) {
      node.evolves_to.forEach((next) => this.extractChain(next, out));
    }
    return [...new Set(out)];
  }
}

class FavoritesService {
  constructor() {
    this.key = "pokedex_lab_pastel_favs";
    this.list = JSON.parse(localStorage.getItem(this.key) || "[]");
  }

  all() {
    return this.list;
  }

  has(id) {
    return this.list.some((x) => x.id === id);
  }

  toggle(pokemon) {
    if (this.has(pokemon.id)) {
      this.list = this.list.filter((x) => x.id !== pokemon.id);
      this.save();
      return false;
    }
    this.list.push({
      id: pokemon.id,
      name: pokemon.name,
      sprite: getArtworkUrl(pokemon, "artwork"),
    });
    this.save();
    return true;
  }

  remove(id) {
    this.list = this.list.filter((x) => x.id !== id);
    this.save();
  }

  save() {
    localStorage.setItem(this.key, JSON.stringify(this.list));
  }
}

/* =========================================================
   INSTÂNCIAS, CONSTANTES & EFEITOS VISUAIS POR ELEMENTO
   ========================================================= */
const gateway = new LabApiGateway();
const catalogService = new CatalogService(gateway);
const speciesService = new SpeciesStatsService(gateway);
const favoritesService = new FavoritesService();

const appState = {
  currentPage: 1,
  totalPages: 113,
  activeType: "all",
  lastCatalogItems: [],
  selectedPokemon: null,
  visualMode: "artwork",
  arenaSlots: [null, null],
  arenaTab: "battle",
  battleSessionId: 0,
  isFighting: false,
};

const QUICK_FIGHTERS = [
  { id: 9, name: "blastoise", label: "Blastoise (#009)" },
  { id: 25, name: "pikachu", label: "Pikachu (#025)" },
  { id: 6, name: "charizard", label: "Charizard (#006)" },
  { id: 3, name: "venusaur", label: "Venusaur (#003)" },
  { id: 94, name: "gengar", label: "Gengar (#094)" },
  { id: 448, name: "lucario", label: "Lucario (#448)" },
  { id: 149, name: "dragonite", label: "Dragonite (#149)" },
  { id: 282, name: "gardevoir", label: "Gardevoir (#282)" },
  { id: 150, name: "mewtwo", label: "Mewtwo (#150)" },
  { id: 143, name: "snorlax", label: "Snorlax (#143)" },
];

const PT_TYPES = {
  normal: "Normal", fire: "Fogo", water: "Água", grass: "Planta",
  electric: "Elétrico", ice: "Gelo", fighting: "Lutador", poison: "Venenoso",
  ground: "Terra", flying: "Voador", psychic: "Psíquico", bug: "Inseto",
  rock: "Pedra", ghost: "Fantasma", dragon: "Dragão", dark: "Sombrio",
  steel: "Aço", fairy: "Fada",
};

/* =========================================================
   BIBLIOTECA DE PROJÉTEIS & IMPACTOS ELEMENTAIS (18 TIPOS)
   ========================================================= */
const ELEMENTAL_FX = {
  water: {
    badgeColor: "#bae6fd",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 90 48">
        <defs>
          <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.15"/>
            <stop offset="60%" stop-color="#0284c7"/>
            <stop offset="100%" stop-color="#e0f2fe"/>
          </linearGradient>
        </defs>
        <path d="M4,24 Q32,10 68,14 C82,16 86,24 86,24 C86,24 82,32 68,34 Q32,38 4,24 Z" fill="url(#waterGrad)" stroke="#0369a1" stroke-width="1.5"/>
        <circle cx="72" cy="24" r="7" fill="#ffffff" opacity="0.85"/>
        <circle cx="48" cy="11" r="4" fill="#38bdf8" stroke="#0369a1" stroke-width="1"/>
        <circle cx="36" cy="37" r="3.5" fill="#7dd3fc" stroke="#0369a1" stroke-width="1"/>
        <circle cx="20" cy="14" r="3" fill="#bae6fd"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="26" fill="none" stroke="#0284c7" stroke-width="4" stroke-dasharray="12 8"/>
        <path d="M50,12 C56,24 56,30 50,30 C44,30 44,24 50,12 Z" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/>
        <path d="M84,36 C74,44 68,42 70,36 C72,30 78,32 84,36 Z" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/>
        <path d="M16,36 C26,44 32,42 30,36 C28,30 22,32 16,36 Z" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/>
        <circle cx="26" cy="72" r="6" fill="#7dd3fc" stroke="#0369a1" stroke-width="1.5"/>
        <circle cx="74" cy="72" r="6" fill="#7dd3fc" stroke="#0369a1" stroke-width="1.5"/>
        <circle cx="50" cy="50" r="14" fill="#e0f2fe" opacity="0.85"/>
      </svg>
    `,
  },

  electric: {
    badgeColor: "#fef08a",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 96 48">
        <polygon points="4,22 36,12 30,22 64,10 56,22 92,24 54,36 60,26 26,38 34,26"
          fill="#facc15" stroke="#18181b" stroke-width="2" stroke-linejoin="round"/>
        <polygon points="18,23 42,17 38,23 78,24 44,31 48,25"
          fill="#ffffff"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,4 58,34 90,22 66,48 94,70 60,64 56,96 42,66 10,78 34,52 8,28 40,36"
          fill="#fde047" stroke="#18181b" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="50" cy="50" r="16" fill="#ffffff"/>
      </svg>
    `,
  },

  fire: {
    badgeColor: "#fed7aa",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 94 50">
        <path d="M6,25 Q26,8 52,12 C68,8 88,18 88,25 C88,32 68,42 52,38 Q26,42 6,25 Z"
          fill="#f97316" stroke="#9a3412" stroke-width="1.8"/>
        <path d="M28,25 Q46,14 66,18 C76,18 82,22 82,25 C82,28 76,32 66,32 Q46,36 28,25 Z"
          fill="#facc15"/>
        <circle cx="71" cy="25" r="7" fill="#fffbeb"/>
        <circle cx="24" cy="10" r="3" fill="#fb923c"/>
        <circle cx="18" cy="40" r="2.5" fill="#f97316"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <path d="M50,8 C58,24 76,20 72,36 C88,38 86,56 72,62 C80,78 62,86 50,74 C38,86 20,78 28,62 C14,56 12,38 28,36 C24,20 42,24 50,8 Z"
          fill="#f97316" stroke="#7c2d12" stroke-width="2"/>
        <circle cx="50" cy="50" r="20" fill="#fde047"/>
        <circle cx="50" cy="50" r="10" fill="#ffffff"/>
      </svg>
    `,
  },

  grass: {
    badgeColor: "#bbf7d0",
    spin: true,
    projectileSvg: `
      <svg viewBox="0 0 70 70">
        <path d="M35,6 C48,18 48,30 35,35 C22,30 22,18 35,6 Z" fill="#22c55e" stroke="#14532d" stroke-width="1.8"/>
        <path d="M64,35 C52,48 40,48 35,35 C40,22 52,22 64,35 Z" fill="#4ade80" stroke="#14532d" stroke-width="1.8"/>
        <path d="M35,64 C22,52 22,40 35,35 C48,40 48,52 35,64 Z" fill="#16a34a" stroke="#14532d" stroke-width="1.8"/>
        <path d="M6,35 C18,22 30,22 35,35 C30,48 18,48 6,35 Z" fill="#86efac" stroke="#14532d" stroke-width="1.8"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <ellipse cx="26" cy="24" rx="12" ry="6" transform="rotate(-35 26 24)" fill="#22c55e" stroke="#14532d" stroke-width="1.8"/>
        <ellipse cx="76" cy="26" rx="12" ry="6" transform="rotate(35 76 26)" fill="#4ade80" stroke="#14532d" stroke-width="1.8"/>
        <ellipse cx="24" cy="74" rx="12" ry="6" transform="rotate(35 24 74)" fill="#16a34a" stroke="#14532d" stroke-width="1.8"/>
        <ellipse cx="76" cy="74" rx="12" ry="6" transform="rotate(-35 76 74)" fill="#86efac" stroke="#14532d" stroke-width="1.8"/>
        <circle cx="50" cy="50" r="14" fill="#dcfce7" stroke="#15803d" stroke-width="2"/>
      </svg>
    `,
  },

  ice: {
    badgeColor: "#cffafe",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 90 48">
        <polygon points="16,12 58,8 86,15 58,20" fill="#67e8f9" stroke="#0e7490" stroke-width="1.6"/>
        <polygon points="6,24 62,19 92,24 62,29" fill="#cffafe" stroke="#0e7490" stroke-width="1.8"/>
        <polygon points="18,36 56,30 82,35 56,41" fill="#22d3ee" stroke="#0e7490" stroke-width="1.6"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,6 58,38 92,50 58,62 50,94 42,62 8,50 42,38" fill="#a5f3fc" stroke="#0e7490" stroke-width="2"/>
        <polygon points="24,24 44,44 24,76 44,56 76,76 56,56 76,24 56,44" fill="#ffffff" opacity="0.85"/>
      </svg>
    `,
  },

  psychic: {
    badgeColor: "#fbcfe8",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 52">
        <ellipse cx="32" cy="26" rx="12" ry="20" fill="none" stroke="#db2777" stroke-width="3"/>
        <ellipse cx="52" cy="26" rx="14" ry="22" fill="none" stroke="#f472b6" stroke-width="3.5"/>
        <ellipse cx="70" cy="26" rx="12" ry="18" fill="#fdf2f8" stroke="#be185d" stroke-width="2.5"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="38" fill="none" stroke="#ec4899" stroke-width="4" stroke-dasharray="10 6"/>
        <circle cx="50" cy="50" r="24" fill="none" stroke="#f472b6" stroke-width="4"/>
        <circle cx="50" cy="50" r="12" fill="#fce7f3" stroke="#be185d" stroke-width="2"/>
      </svg>
    `,
  },

  ghost: {
    badgeColor: "#ddd6fe",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 50">
        <path d="M10,25 Q30,8 56,12 C74,12 82,18 82,25 C82,32 74,38 56,38 Q30,42 10,25 Z"
          fill="#6366f1" stroke="#312e81" stroke-width="1.8"/>
        <circle cx="64" cy="25" r="11" fill="#312e81"/>
        <circle cx="66" cy="25" r="6" fill="#c7d2fe"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="30" fill="#4f46e5" opacity="0.7" stroke="#1e1b4b" stroke-width="2.5"/>
        <circle cx="32" cy="26" r="8" fill="#818cf8"/>
        <circle cx="72" cy="30" r="7" fill="#818cf8"/>
        <circle cx="68" cy="74" r="9" fill="#6366f1"/>
        <circle cx="50" cy="50" r="14" fill="#eef2ff"/>
      </svg>
    `,
  },

  dragon: {
    badgeColor: "#bfdbfe",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 94 50">
        <path d="M6,25 L34,8 L28,20 L88,25 L28,30 L34,42 Z" fill="#2563eb" stroke="#1e3a8a" stroke-width="1.8"/>
        <circle cx="72" cy="25" r="10" fill="#93c5fd" stroke="#1d4ed8" stroke-width="2"/>
        <circle cx="74" cy="25" r="5" fill="#ffffff"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,6 64,36 94,50 64,64 50,94 36,64 6,50 36,36" fill="#3b82f6" stroke="#1e3a8a" stroke-width="2.2"/>
        <circle cx="50" cy="50" r="18" fill="#dbeafe"/>
      </svg>
    `,
  },

  fairy: {
    badgeColor: "#fce7f3",
    spin: true,
    projectileSvg: `
      <svg viewBox="0 0 70 70">
        <polygon points="35,4 43,27 66,35 43,43 35,66 27,43 4,35 27,27"
          fill="#f9a8d4" stroke="#831843" stroke-width="1.8"/>
        <circle cx="35" cy="35" r="8" fill="#fef08a"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,10 56,36 82,42 56,48 50,74 44,48 18,42 44,36" fill="#f472b6" stroke="#831843" stroke-width="1.8"/>
        <polygon points="26,20 29,29 38,32 29,35 26,44 23,35 14,32 23,29" fill="#fde047"/>
        <polygon points="74,56 77,65 86,68 77,71 74,80 71,71 62,68 71,65" fill="#fde047"/>
      </svg>
    `,
  },

  fighting: {
    badgeColor: "#fecaca",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 84 52">
        <circle cx="56" cy="26" r="18" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/>
        <circle cx="58" cy="26" r="10" fill="#fca5a5"/>
        <path d="M10,16 L36,20 M6,26 L34,26 M10,36 L36,32" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,6 60,34 90,26 68,48 92,72 60,64 50,94 40,64 8,72 32,48 10,26 40,34"
          fill="#f87171" stroke="#7f1d1d" stroke-width="2.2"/>
        <circle cx="50" cy="50" r="15" fill="#ffffff"/>
      </svg>
    `,
  },

  rock: {
    badgeColor: "#e7e5e4",
    spin: true,
    projectileSvg: `
      <svg viewBox="0 0 70 70">
        <polygon points="35,8 58,20 62,46 42,62 16,56 10,28" fill="#a8a29e" stroke="#292524" stroke-width="2.2"/>
        <polyline points="24,22 38,34 52,26" fill="none" stroke="#57534e" stroke-width="2"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="24,20 38,16 34,32 18,30" fill="#a8a29e" stroke="#292524" stroke-width="2"/>
        <polygon points="72,18 86,28 74,38 64,26" fill="#78716c" stroke="#292524" stroke-width="2"/>
        <polygon points="20,68 36,64 32,82 16,78" fill="#78716c" stroke="#292524" stroke-width="2"/>
        <polygon points="68,66 84,70 78,86 64,80" fill="#a8a29e" stroke="#292524" stroke-width="2"/>
      </svg>
    `,
  },

  ground: {
    badgeColor: "#fef08a",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 92 48">
        <polygon points="10,42 26,14 40,42" fill="#ca8a04" stroke="#422006" stroke-width="1.8"/>
        <polygon points="32,42 52,8 68,42" fill="#eab308" stroke="#422006" stroke-width="1.8"/>
        <polygon points="58,42 76,16 88,42" fill="#a16207" stroke="#422006" stroke-width="1.8"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="20,82 34,26 48,82" fill="#eab308" stroke="#422006" stroke-width="2"/>
        <polygon points="42,82 58,18 74,82" fill="#ca8a04" stroke="#422006" stroke-width="2"/>
        <polygon points="64,82 78,34 90,82" fill="#facc15" stroke="#422006" stroke-width="2"/>
      </svg>
    `,
  },

  poison: {
    badgeColor: "#e9d5ff",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 50">
        <circle cx="62" cy="25" r="14" fill="#a855f7" stroke="#4c1d95" stroke-width="2"/>
        <circle cx="42" cy="18" r="8" fill="#c084fc" stroke="#4c1d95" stroke-width="1.6"/>
        <circle cx="38" cy="34" r="7" fill="#9333ea" stroke="#4c1d95" stroke-width="1.6"/>
        <circle cx="20" cy="25" r="5" fill="#d8b4fe"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="24" fill="#a855f7" stroke="#4c1d95" stroke-width="2.2"/>
        <circle cx="28" cy="26" r="9" fill="#c084fc" stroke="#4c1d95" stroke-width="1.8"/>
        <circle cx="74" cy="28" r="8" fill="#c084fc" stroke="#4c1d95" stroke-width="1.8"/>
        <circle cx="70" cy="74" r="10" fill="#9333ea" stroke="#4c1d95" stroke-width="1.8"/>
      </svg>
    `,
  },

  flying: {
    badgeColor: "#dbeafe",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 90 52">
        <path d="M26,8 Q72,26 26,44 Q52,26 26,8 Z" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>
        <path d="M48,6 Q90,26 48,46 Q72,26 48,6 Z" fill="#ffffff" stroke="#0369a1" stroke-width="2"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <path d="M20,30 Q50,12 80,30" fill="none" stroke="#0284c7" stroke-width="4" stroke-linecap="round"/>
        <path d="M14,50 Q50,32 86,50" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
        <path d="M20,70 Q50,52 80,70" fill="none" stroke="#0284c7" stroke-width="4" stroke-linecap="round"/>
      </svg>
    `,
  },

  bug: {
    badgeColor: "#ecfccb",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 48">
        <polygon points="34,12 76,15 34,19" fill="#84cc16" stroke="#365314" stroke-width="1.5"/>
        <polygon points="18,24 88,24 18,28" fill="#a3e635" stroke="#365314" stroke-width="1.6"/>
        <polygon points="34,33 76,36 34,40" fill="#84cc16" stroke="#365314" stroke-width="1.5"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="26" fill="none" stroke="#84cc16" stroke-width="4" stroke-dasharray="6 6"/>
        <circle cx="50" cy="50" r="14" fill="#d9f99d" stroke="#365314" stroke-width="2"/>
      </svg>
    `,
  },

  dark: {
    badgeColor: "#d4d4d8",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 52">
        <path d="M36,6 C74,10 74,42 36,46 C56,34 56,18 36,6 Z" fill="#27272a" stroke="#09090b" stroke-width="2"/>
        <path d="M16,12 C48,15 48,37 16,40 C32,31 32,21 16,12 Z" fill="#52525b"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="28" fill="#18181b" stroke="#71717a" stroke-width="2.5"/>
        <line x1="22" y1="22" x2="78" y2="78" stroke="#facc15" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="78" y1="22" x2="22" y2="78" stroke="#facc15" stroke-width="3.5" stroke-linecap="round"/>
      </svg>
    `,
  },

  steel: {
    badgeColor: "#e2e8f0",
    spin: true,
    projectileSvg: `
      <svg viewBox="0 0 70 70">
        <circle cx="35" cy="35" r="20" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.2"/>
        <circle cx="35" cy="35" r="9" fill="#ffffff" stroke="#1e293b" stroke-width="2"/>
        <line x1="35" y1="8" x2="35" y2="62" stroke="#1e293b" stroke-width="3"/>
        <line x1="8" y1="35" x2="62" y2="35" stroke="#1e293b" stroke-width="3"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,8 60,40 92,50 60,60 50,92 40,60 8,50 40,40" fill="#e2e8f0" stroke="#0f172a" stroke-width="2.2"/>
        <circle cx="50" cy="50" r="14" fill="#ffffff"/>
      </svg>
    `,
  },

  normal: {
    badgeColor: "#fef9c3",
    spin: false,
    projectileSvg: `
      <svg viewBox="0 0 88 48">
        <ellipse cx="56" cy="24" rx="24" ry="13" fill="#fef08a" stroke="#18181b" stroke-width="2"/>
        <ellipse cx="62" cy="24" rx="12" ry="7" fill="#ffffff"/>
        <line x1="8" y1="24" x2="28" y2="24" stroke="#18181b" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `,
    impactSvg: `
      <svg viewBox="0 0 100 100">
        <polygon points="50,10 60,38 90,50 60,62 50,90 40,62 10,50 40,38" fill="#fef08a" stroke="#18181b" stroke-width="2"/>
        <circle cx="50" cy="50" r="14" fill="#ffffff"/>
      </svg>
    `,
  },
};

const TYPE_CHART = {
  fire:     { grass: 2, ice: 2, bug: 2, steel: 2, water: 0.5, fire: 0.5, rock: 0.5, dragon: 0.5 },
  water:    { fire: 2, ground: 2, rock: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  grass:    { water: 2, ground: 2, rock: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5 },
  electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  ghost:    { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  fairy:    { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, ghost: 0, psychic: 0.5, flying: 0.5, fairy: 0.5 },
  ground:   { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
  ice:      { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
  rock:     { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  flying:   { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  poison:   { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  bug:      { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, flying: 0.5, ghost: 0.5, fairy: 0.5 },
  dark:     { psychic: 2, ghost: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel:    { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  normal:   { ghost: 0, rock: 0.5, steel: 0.5 },
};

const PT_STATS = {
  hp: "PS",
  attack: "Ataque",
  defense: "Defesa",
  "special-attack": "Atq. Esp.",
  "special-defense": "Def. Esp.",
  speed: "Velocidade",
};

function padId(id) {
  return `#${String(id).padStart(3, "0")}`;
}

function getArtworkUrl(pokemon, mode = "artwork") {
  const art = pokemon.sprites?.other?.["official-artwork"];
  if (mode === "shiny") {
    return art?.front_shiny || pokemon.sprites?.front_shiny || art?.front_default || "";
  }
  if (mode === "pixel") {
    return pokemon.sprites?.front_default || art?.front_default || "";
  }
  return art?.front_default || pokemon.sprites?.front_default || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer;
function showToast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function isPokemonInArena(id) {
  return appState.arenaSlots.some((p) => p && p.id === id);
}

/* =========================================================
   SINTETIZADOR DE EFEITOS SONOROS ELEMENTAIS (WEB AUDIO API)
   ========================================================= */
let sharedAudioCtx = null;
function playElementalSfx(typeName) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();

    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();

    if (typeName === "electric") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(920, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.18);
    } else if (typeName === "water" || typeName === "ice") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.22);
    } else if (typeName === "fire" || typeName === "dragon") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.26);
    } else if (typeName === "grass" || typeName === "flying" || typeName === "bug") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.16);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.18);
    }

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  } catch {
    // Ignora silenciosamente se o navegador bloquear áudio automático
  }
}

/* =========================================================
   CATÁLOGO & CARTÕES 3D
   ========================================================= */
function renderSkeletons(count = PAGE_LIMIT) {
  document.getElementById("pokemon-grid").innerHTML = Array.from({ length: count })
    .map(() => `<div class="skeleton-box"></div>`)
    .join("");
}

function showCatalogError(msg = "") {
  const el = document.getElementById("catalog-alert");
  if (!msg) {
    el.classList.add("hidden");
  } else {
    el.textContent = msg;
    el.classList.remove("hidden");
  }
}

async function loadCatalog(page = 1) {
  showCatalogError("");
  renderSkeletons();
  document.getElementById("pagination-bar").classList.remove("hidden");

  try {
    const { items, totalPages, currentPage } = await catalogService.getPage(
      page,
      appState.activeType
    );
    appState.currentPage = currentPage;
    appState.totalPages = totalPages;
    appState.lastCatalogItems = items;

    renderCards(items);
    document.getElementById("results-caption").textContent = `${items.length} exibidos`;
    document.getElementById("page-current").textContent = String(currentPage).padStart(2, "0");
    document.getElementById("page-total").textContent = String(totalPages);
    document.getElementById("prev-btn").disabled = currentPage <= 1;
    document.getElementById("next-btn").disabled = currentPage >= totalPages;
    renderPageDots(currentPage, totalPages);
  } catch {
    document.getElementById("pokemon-grid").innerHTML = "";
    showCatalogError(
      "Indisponibilidade detectada na PokéAPI. Verifique sua conexão ou o interruptor 'API Online' no topo."
    );
  }
}

function renderPageDots(current, total) {
  const container = document.getElementById("page-jump-dots");
  const pages = new Set([1, current - 1, current, current + 1, total]);
  const valid = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  container.innerHTML = valid
    .map(
      (p) =>
        `<button type="button" class="dot-btn ${p === current ? "active" : ""}" data-page="${p}">${p}</button>`
    )
    .join("");

  container.querySelectorAll(".dot-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadCatalog(Number(btn.dataset.page)));
  });
}

function renderCards(list) {
  const grid = document.getElementById("pokemon-grid");
  grid.innerHTML = list
    .map((p) => {
      const mainType = PT_TYPES[p.types[0]?.type.name] || "";
      const isSelected = appState.selectedPokemon?.id === p.id ? "selected" : "";
      const inArena = isPokemonInArena(p.id);
      return `
        <div class="poke-card-3d ${isSelected}" role="button" tabindex="0" data-id="${p.id}">
          <div class="card-top-meta">
            <span>${padId(p.id)}</span>
            <button
              type="button"
              class="card-quick-battle ${inArena ? "in-arena" : ""}"
              data-quick-arena="${p.id}"
              title="${inArena ? "Remover da Arena" : "Enviar direto para a Arena de Batalha"}"
            >⚔️</button>
          </div>
          <div class="card-sprite-box">
            <img src="${getArtworkUrl(p, "artwork")}" alt="${p.name}" loading="lazy" />
          </div>
          <div class="card-bottom-row">
            <span class="card-poke-name">${p.name}</span>
            <span class="mini-type-dot">${mainType}</span>
          </div>
        </div>
      `;
    })
    .join("");

  grid.querySelectorAll(".poke-card-3d").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rx = ((y / rect.height) - 0.5) * -10;
      const ry = ((x / rect.width) - 0.5) * 10;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });

    card.addEventListener("click", () => openInspector(card.dataset.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openInspector(card.dataset.id);
      }
    });
  });

  grid.querySelectorAll("[data-quick-arena]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.quickArena);
      const found = list.find((item) => item.id === id);
      if (found) {
        toggleArenaPokemon(found);
      } else {
        const { data } = await catalogService.getByQuery(id);
        toggleArenaPokemon(data);
      }
    });
  });
}

function syncAllArenaBadges() {
  document.querySelectorAll("[data-quick-arena]").forEach((btn) => {
    const id = Number(btn.dataset.quickArena);
    btn.classList.toggle("in-arena", isPokemonInArena(id));
  });

  if (appState.selectedPokemon) {
    const inspectorBtn = document.getElementById("btn-arena-toggle");
    if (inspectorBtn) {
      const inArena = isPokemonInArena(appState.selectedPokemon.id);
      inspectorBtn.classList.toggle("btn-pastel", inArena);
      inspectorBtn.classList.toggle("btn-white", !inArena);
      inspectorBtn.textContent = inArena ? "✓ Na Arena" : "⚔️ Enviar p/ Arena";
    }
  }
}

/* =========================================================
   ARENA DE BATALHA INTERATIVA (SELETORES + CAMPO + RADAR)
   ========================================================= */
function toggleArenaPokemon(pokemon) {
  appState.battleSessionId++;
  appState.isFighting = false;

  const existingIdx = appState.arenaSlots.findIndex((p) => p && p.id === pokemon.id);
  if (existingIdx >= 0) {
    appState.arenaSlots[existingIdx] = null;
    showToast(`${pokemon.name} saiu da arena.`);
  } else if (!appState.arenaSlots[0]) {
    appState.arenaSlots[0] = pokemon;
    showToast(`${pokemon.name} entrou como Lutador 1!`);
  } else if (!appState.arenaSlots[1]) {
    appState.arenaSlots[1] = pokemon;
    showToast(`${pokemon.name} entrou como Lutador 2!`);
  } else {
    appState.arenaSlots[1] = pokemon;
    showToast(`${pokemon.name} assumiu o posto de Lutador 2!`);
  }

  renderArena();
  syncAllArenaBadges();
}

async function setArenaSlot(slotIdx, idOrName) {
  const clean = String(idOrName).trim().toLowerCase();
  if (!clean) return;

  try {
    const { data } = await catalogService.getByQuery(clean);
    appState.battleSessionId++;
    appState.isFighting = false;
    appState.arenaSlots[slotIdx] = data;
    renderArena();
    syncAllArenaBadges();
    showToast(`${data.name} selecionado como Lutador ${slotIdx + 1}!`);
  } catch {
    showToast(`Pokémon "${idOrName}" não encontrado.`);
  }
}

function getTypeMultiplier(attackerType, defenderTypes) {
  let mult = 1;
  defenderTypes.forEach((defT) => {
    const chart = TYPE_CHART[attackerType] || {};
    if (chart[defT] !== undefined) mult *= chart[defT];
  });
  return mult;
}

function getPokemonMoves(pokemon) {
  if (!Array.isArray(pokemon.moves) || pokemon.moves.length === 0) {
    return ["Investida", "Ataque Rápido", "Pulso Elemental"];
  }
  return pokemon.moves.slice(0, 12).map((m) =>
    m.move.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function buildDualRadarSvg(p1, p2) {
  const size = 210;
  const c = size / 2;
  const maxR = 70;
  const angles = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);
  const labels = ["PS", "ATQ", "DEF", "VEL", "D.ESP", "A.ESP"];

  const getOrdered = (p) => [
    p.stats[0].base_stat,
    p.stats[1].base_stat,
    p.stats[2].base_stat,
    p.stats[5].base_stat,
    p.stats[4].base_stat,
    p.stats[3].base_stat,
  ];

  const toPolygon = (vals) =>
    vals
      .map((v, i) => {
        const r = Math.max(10, Math.min(1, v / 180) * maxR);
        return `${c + r * Math.cos(angles[i])},${c + r * Math.sin(angles[i])}`;
      })
      .join(" ");

  const rings = [0.33, 0.66, 1]
    .map((s) => {
      const pts = angles
        .map((a) => `${c + maxR * s * Math.cos(a)},${c + maxR * s * Math.sin(a)}`)
        .join(" ");
      return `<polygon points="${pts}" fill="none" stroke="#e8e1c5" stroke-width="1" />`;
    })
    .join("");

  const axisLines = angles
    .map(
      (a) =>
        `<line x1="${c}" y1="${c}" x2="${c + maxR * Math.cos(a)}" y2="${c + maxR * Math.sin(a)}" stroke="#efe9d1" stroke-width="1" />`
    )
    .join("");

  const textTags = angles
    .map((a, i) => {
      const x = c + (maxR + 20) * Math.cos(a);
      const y = c + (maxR + 15) * Math.sin(a);
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono" font-size="9" font-weight="700" fill="#52525b">${labels[i]}</text>`;
    })
    .join("");

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${rings}
      ${axisLines}
      <polygon points="${toPolygon(getOrdered(p1))}" fill="rgba(253, 224, 71, 0.45)" stroke="#ca8a04" stroke-width="2" />
      <polygon points="${toPolygon(getOrdered(p2))}" fill="rgba(24, 24, 27, 0.08)" stroke="#18181b" stroke-width="1.8" stroke-dasharray="4 3" />
      ${textTags}
    </svg>
  `;
}

function buildSlotHtml(slotIdx, pokemon) {
  if (pokemon) {
    return `
      <div class="slot-box">
        <div class="slot-filled">
          <img src="${getArtworkUrl(pokemon)}" alt="${pokemon.name}" />
          <div class="slot-meta">
            <span class="slot-tag">LUTADOR ${slotIdx + 1}</span>
            <strong class="slot-name">${pokemon.name}</strong>
          </div>
          <button type="button" class="slot-clear-btn" data-clear-slot="${slotIdx}" title="Trocar Lutador ${slotIdx + 1}">×</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="slot-box">
      <div class="slot-empty-wrap">
        <input
          type="text"
          class="slot-search-input"
          data-slot-input="${slotIdx}"
          placeholder="+ Lutador ${slotIdx + 1} (nome ou #)..."
          autocomplete="off"
        />
        <div class="slot-dropdown hidden" data-slot-dropdown="${slotIdx}"></div>
      </div>
    </div>
  `;
}

function renderArena() {
  const container = document.getElementById("compare-body");
  const clearBtn = document.getElementById("clear-compare-btn");
  const [p1, p2] = appState.arenaSlots;
  const hasAny = Boolean(p1 || p2);

  clearBtn.classList.toggle("hidden", !hasAny);

  const slotsBarHtml = `
    <div class="arena-slots-bar">
      ${buildSlotHtml(0, p1)}
      <button type="button" id="swap-fighters-btn" class="swap-btn" title="Inverter lados">⇄</button>
      ${buildSlotHtml(1, p2)}
    </div>
  `;

  if (!p1 && !p2) {
    container.innerHTML = `
      ${slotsBarHtml}
      <p class="empty-hint">
        Clique em <strong>+ Lutador 1</strong> e <strong>+ Lutador 2</strong> acima para escolher da lista ou digitar qualquer nome, ou use <strong>⚔️</strong> nos cartões.
      </p>
    `;
    bindSlotEvents(container);
    return;
  }

  if (!p1 || !p2) {
    container.innerHTML = `
      ${slotsBarHtml}
      <div class="battlefield-stage" style="min-height: 185px;">
        <div class="combatants-zone" style="height: 118px;">
          <div class="fighter-unit left">
            ${
              p1
                ? `<img class="fighter-sprite" src="${getArtworkUrl(p1)}" alt="${p1.name}" />`
                : `<span class="empty-hint" style="font-size:0.74rem;margin-bottom:26px;">Escolha o 1º</span>`
            }
            <div class="energy-pad"></div>
          </div>

          <div class="vs-emblem">VS</div>

          <div class="fighter-unit right">
            ${
              p2
                ? `<img class="fighter-sprite" src="${getArtworkUrl(p2)}" alt="${p2.name}" />`
                : `<span class="empty-hint" style="font-size:0.74rem;margin-bottom:26px;">Escolha o 2º</span>`
            }
            <div class="energy-pad"></div>
          </div>
        </div>
        <div class="battle-console">
          <span class="console-text"><strong>${(p1 || p2).name}</strong> aguarda o oponente no campo!</span>
        </div>
      </div>
    `;
    bindSlotEvents(container);
    return;
  }

  const maxHp1 = Math.round(p1.stats[0].base_stat * 2.2 + 65);
  const maxHp2 = Math.round(p2.stats[0].base_stat * 2.2 + 65);
  const bst1 = p1.stats.reduce((a, s) => a + s.base_stat, 0);
  const bst2 = p2.stats.reduce((a, s) => a + s.base_stat, 0);

  const rows = p1.stats
    .map((s, i) => {
      const v1 = s.base_stat;
      const v2 = p2.stats[i].base_stat;
      return `
        <tr>
          <td class="${v1 > v2 ? "win-cell" : ""}">${v1}</td>
          <td class="lbl">${PT_STATS[s.stat.name] || s.stat.name}</td>
          <td class="${v2 > v1 ? "win-cell" : ""}">${v2}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    ${slotsBarHtml}

    <div class="arena-mode-tabs">
      <button type="button" class="arena-tab-btn ${appState.arenaTab === "battle" ? "active" : ""}" data-atab="battle">
        ⚔️ Campo de Batalha
      </button>
      <button type="button" class="arena-tab-btn ${appState.arenaTab === "radar" ? "active" : ""}" data-atab="radar">
        📊 Radar &amp; Status
      </button>
    </div>

    <!-- ABA 1: CAMPO DE BATALHA ANIMADO -->
    <div id="arena-panel-battle" class="${appState.arenaTab === "battle" ? "" : "hidden"}">
      <div class="battlefield-stage" id="battlefield-stage">
        <div class="battle-huds">
          <div class="hp-box" id="hud-p1">
            <div class="hp-top-line">
              <span class="hp-name">${p1.name}</span>
              <span class="hp-lvl">NV.50</span>
            </div>
            <div class="hp-bar-outer">
              <div class="hp-bar-inner" id="hp-fill-1" style="width:100%"></div>
            </div>
            <div class="hp-numbers">
              <span>${p1.types.map((t) => PT_TYPES[t.type.name] || t.type.name).join("/")}</span>
              <span id="hp-text-1">${maxHp1}/${maxHp1}</span>
            </div>
          </div>

          <div class="hp-box" id="hud-p2">
            <div class="hp-top-line">
              <span class="hp-name">${p2.name}</span>
              <span class="hp-lvl">NV.50</span>
            </div>
            <div class="hp-bar-outer">
              <div class="hp-bar-inner" id="hp-fill-2" style="width:100%"></div>
            </div>
            <div class="hp-numbers">
              <span>${p2.types.map((t) => PT_TYPES[t.type.name] || t.type.name).join("/")}</span>
              <span id="hp-text-2">${maxHp2}/${maxHp2}</span>
            </div>
          </div>
        </div>

        <div class="combatants-zone" id="combatants-zone">
          <div class="fighter-unit left" id="unit-p1">
            <img class="fighter-sprite" src="${getArtworkUrl(p1)}" alt="${p1.name}" />
            <div class="energy-pad"></div>
          </div>

          <div class="vs-emblem">VS</div>

          <div class="fighter-unit right" id="unit-p2">
            <img class="fighter-sprite" src="${getArtworkUrl(p2)}" alt="${p2.name}" />
            <div class="energy-pad"></div>
          </div>
        </div>

        <div id="winner-banner" class="winner-banner hidden"></div>

        <div class="battle-console">
          <span class="console-text" id="battle-log">
            <strong>${p1.name}</strong> vs <strong>${p2.name}</strong> · Pronto para lutar!
          </span>
          <button type="button" id="start-battle-btn" class="battle-cta-btn">▶ Lutar</button>
        </div>
      </div>
    </div>

    <!-- ABA 2: RADAR DUPLO -->
    <div id="arena-panel-radar" class="${appState.arenaTab === "radar" ? "" : "hidden"}">
      <div class="dual-radar-wrap">
        ${buildDualRadarSvg(p1, p2)}
      </div>
      <table class="arena-table">
        <tbody>
          ${rows}
          <tr>
            <td class="${bst1 > bst2 ? "win-cell" : ""}"><strong>${bst1}</strong></td>
            <td class="lbl">TOTAL (BST)</td>
            <td class="${bst2 > bst1 ? "win-cell" : ""}"><strong>${bst2}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  bindSlotEvents(container);

  container.querySelectorAll("[data-atab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.arenaTab = btn.dataset.atab;
      document.getElementById("arena-panel-battle").classList.toggle("hidden", appState.arenaTab !== "battle");
      document.getElementById("arena-panel-radar").classList.toggle("hidden", appState.arenaTab !== "radar");
      container.querySelectorAll("[data-atab]").forEach((b) =>
        b.classList.toggle("active", b.dataset.atab === appState.arenaTab)
      );
    });
  });

  document.getElementById("start-battle-btn").addEventListener("click", () => {
    runAnimatedBattle(p1, p2);
  });
}

function bindSlotEvents(container) {
  container.querySelectorAll("[data-clear-slot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.clearSlot);
      appState.battleSessionId++;
      appState.isFighting = false;
      appState.arenaSlots[idx] = null;
      renderArena();
      syncAllArenaBadges();
    });
  });

  document.getElementById("swap-fighters-btn")?.addEventListener("click", () => {
    appState.battleSessionId++;
    appState.isFighting = false;
    appState.arenaSlots = [appState.arenaSlots[1], appState.arenaSlots[0]];
    renderArena();
  });

  container.querySelectorAll("[data-slot-input]").forEach((input) => {
    const slotIdx = Number(input.dataset.slotInput);
    const dropdown = container.querySelector(`[data-slot-dropdown="${slotIdx}"]`);

    function populateDropdown(term = "") {
      const clean = term.trim().toLowerCase();
      const options = [];

      if (clean) {
        options.push(`
          <button type="button" class="slot-opt highlight" data-pick-val="${clean}">
            <span>🔍 Buscar "${term.trim()}"</span>
            <small>Enter</small>
          </button>
        `);
      }

      if (
        appState.selectedPokemon &&
        (!clean || appState.selectedPokemon.name.includes(clean))
      ) {
        options.push(`
          <button type="button" class="slot-opt" data-pick-val="${appState.selectedPokemon.id}">
            <span>📌 ${appState.selectedPokemon.name}</span>
            <small>Na ficha</small>
          </button>
        `);
      }

      favoritesService.all().forEach((fav) => {
        if (!clean || fav.name.includes(clean)) {
          options.push(`
            <button type="button" class="slot-opt" data-pick-val="${fav.id}">
              <span>★ ${fav.name}</span>
              <small>Favorito</small>
            </button>
          `);
        }
      });

      QUICK_FIGHTERS.forEach((qf) => {
        if (!clean || qf.name.includes(clean) || String(qf.id) === clean) {
          options.push(`
            <button type="button" class="slot-opt" data-pick-val="${qf.id}">
              <span>${qf.name}</span>
              <small>${padId(qf.id)}</small>
            </button>
          `);
        }
      });

      dropdown.innerHTML = options.slice(0, 8).join("");
      dropdown.classList.remove("hidden");

      dropdown.querySelectorAll("[data-pick-val]").forEach((optBtn) => {
        optBtn.addEventListener("click", () => {
          dropdown.classList.add("hidden");
          setArenaSlot(slotIdx, optBtn.dataset.pickVal);
        });
      });
    }

    input.addEventListener("focus", () => {
      document.querySelectorAll(".slot-dropdown").forEach((d) => d.classList.add("hidden"));
      populateDropdown(input.value);
    });

    input.addEventListener("input", () => populateDropdown(input.value));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        dropdown.classList.add("hidden");
        setArenaSlot(slotIdx, input.value.trim());
      } else if (e.key === "Escape") {
        dropdown.classList.add("hidden");
      }
    });
  });
}

/* =========================================================
   MOTOR DE SIMULAÇÃO & DISPARO DE ELEMENTOS NA BATALHA
   ========================================================= */
function spawnElementalProjectile(zoneEl, direction, typeName) {
  const fx = ELEMENTAL_FX[typeName] || ELEMENTAL_FX.normal;
  const proj = document.createElement("div");
  proj.className = `element-projectile ${direction === "right" ? "fly-right" : "fly-left"} ${
    fx.spin ? "spin-fx" : ""
  }`;
  proj.innerHTML = fx.projectileSvg;
  zoneEl.appendChild(proj);
  playElementalSfx(typeName);
  setTimeout(() => proj.remove(), 410);
}

function spawnElementalImpact(unitEl, typeName) {
  const fx = ELEMENTAL_FX[typeName] || ELEMENTAL_FX.normal;
  const impact = document.createElement("div");
  impact.className = "element-impact-fx";
  impact.innerHTML = fx.impactSvg;
  unitEl.appendChild(impact);
  setTimeout(() => impact.remove(), 500);
}

function spawnDamageFloater(unitEl, amount, isSuper, isCrit) {
  const tag = document.createElement("div");
  tag.className = `damage-floater ${isSuper || isCrit ? "super" : ""}`;
  const suffix = isCrit ? " CRÍTICO!" : isSuper ? " 2x!" : "";
  tag.textContent = `-${amount} HP${suffix}`;
  unitEl.appendChild(tag);
  setTimeout(() => tag.remove(), 980);
}

function burstConfetti(stageEl) {
  const colors = ["#facc15", "#fde047", "#18181b", "#fb923c", "#ffffff"];
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 94 + 3}%`;
    piece.style.backgroundColor = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    stageEl.appendChild(piece);
    setTimeout(() => piece.remove(), 2200);
  }
}

function updateHpBar(slotNum, currentHp, maxHp) {
  const fill = document.getElementById(`hp-fill-${slotNum}`);
  const text = document.getElementById(`hp-text-${slotNum}`);
  if (!fill || !text) return;

  const safeHp = Math.max(0, Math.round(currentHp));
  const pct = Math.max(0, Math.min(100, (safeHp / maxHp) * 100));
  fill.style.width = `${pct}%`;
  fill.classList.remove("mid", "low");
  if (pct <= 25) fill.classList.add("low");
  else if (pct <= 55) fill.classList.add("mid");

  text.textContent = `${safeHp}/${maxHp}`;
}

async function runAnimatedBattle(p1, p2) {
  if (appState.isFighting) return;
  appState.isFighting = true;
  const sessionId = ++appState.battleSessionId;

  const stage = document.getElementById("battlefield-stage");
  const zone = document.getElementById("combatants-zone");
  const logEl = document.getElementById("battle-log");
  const startBtn = document.getElementById("start-battle-btn");
  const winnerBanner = document.getElementById("winner-banner");

  const unit1 = document.getElementById("unit-p1");
  const unit2 = document.getElementById("unit-p2");
  const hud1 = document.getElementById("hud-p1");
  const hud2 = document.getElementById("hud-p2");

  winnerBanner.classList.add("hidden");
  [unit1, unit2].forEach((u) => u.classList.remove("fainted", "winner", "lunge", "hit"));
  startBtn.disabled = true;
  startBtn.textContent = "Em combate...";

  const maxHp1 = Math.round(p1.stats[0].base_stat * 2.2 + 65);
  const maxHp2 = Math.round(p2.stats[0].base_stat * 2.2 + 65);
  let hp1 = maxHp1;
  let hp2 = maxHp2;
  updateHpBar(1, hp1, maxHp1);
  updateHpBar(2, hp2, maxHp2);

  const moves1 = getPokemonMoves(p1);
  const moves2 = getPokemonMoves(p2);

  const types1 = p1.types.map((t) => t.type.name);
  const types2 = p2.types.map((t) => t.type.name);

  const spd1 = p1.stats[5].base_stat;
  const spd2 = p2.stats[5].base_stat;
  let turnOwner = spd1 >= spd2 ? 1 : 2;
  let turnCount = 0;

  while (hp1 > 0 && hp2 > 0) {
    if (sessionId !== appState.battleSessionId) return;
    turnCount++;

    const isP1 = turnOwner === 1;
    const atkPoke = isP1 ? p1 : p2;
    const defPoke = isP1 ? p2 : p1;
    const atkUnit = isP1 ? unit1 : unit2;
    const defUnit = isP1 ? unit2 : unit1;
    const atkHud = isP1 ? hud1 : hud2;
    const defHud = isP1 ? hud2 : hud1;
    const atkTypes = isP1 ? types1 : types2;
    const defTypes = isP1 ? types2 : types1;
    const movePool = isP1 ? moves1 : moves2;

    atkHud.classList.add("active-turn");
    defHud.classList.remove("active-turn");

    // Escolhe o elemento disparado neste turno (prioriza o tipo primário e alterna se tiver 2º tipo)
    const activeElement =
      atkTypes.length > 1 && Math.random() < 0.35 ? atkTypes[1] : atkTypes[0];
    const fxMeta = ELEMENTAL_FX[activeElement] || ELEMENTAL_FX.normal;

    const moveName = movePool[Math.floor(Math.random() * movePool.length)];
    const atkPower = Math.max(atkPoke.stats[1].base_stat, atkPoke.stats[3].base_stat);
    const defPower = Math.max(defPoke.stats[2].base_stat, defPoke.stats[4].base_stat);
    const typeMult = getTypeMultiplier(activeElement, defTypes);
    const isCrit = Math.random() < 0.14;
    const variance = 0.88 + Math.random() * 0.24;

    const effectiveMult = typeMult === 0 ? 0.35 : typeMult;
    const rawDamage =
      ((atkPower / Math.max(35, defPower)) * 28 + 12) *
      effectiveMult *
      (isCrit ? 1.45 : 1) *
      variance;
    const damage = Math.max(8, Math.round(rawDamage));

    const effNote =
      typeMult >= 2 ? " Super efetivo!" : typeMult < 1 ? " Pouco efetivo." : "";
    logEl.innerHTML = `T${turnCount}: <strong>${atkPoke.name}</strong> lançou <span class="elem-pill-log" style="background:${fxMeta.badgeColor}">${
      PT_TYPES[activeElement] || activeElement
    }</span> (${moveName})!${effNote}`;

    // 1. Investida + Disparo do Elemento do Pokémon
    atkUnit.classList.add("lunge");
    spawnElementalProjectile(zone, isP1 ? "right" : "left", activeElement);
    await sleep(310);
    if (sessionId !== appState.battleSessionId) return;

    // 2. Explosão Elemental + Impacto + Dano
    defUnit.classList.add("hit");
    spawnElementalImpact(defUnit, activeElement);
    spawnDamageFloater(defUnit, damage, typeMult >= 2, isCrit);

    if (typeMult >= 2 || isCrit) {
      stage.classList.add("arena-quake");
      setTimeout(() => stage.classList.remove("arena-quake"), 360);
    }

    if (isP1) {
      hp2 = Math.max(0, hp2 - damage);
      updateHpBar(2, hp2, maxHp2);
    } else {
      hp1 = Math.max(0, hp1 - damage);
      updateHpBar(1, hp1, maxHp1);
    }

    await sleep(480);
    atkUnit.classList.remove("lunge");
    defUnit.classList.remove("hit");

    if (hp1 <= 0 || hp2 <= 0) break;

    turnOwner = isP1 ? 2 : 1;
    await sleep(280);
  }

  if (sessionId !== appState.battleSessionId) return;

  hud1.classList.remove("active-turn");
  hud2.classList.remove("active-turn");

  const p1Won = hp1 > 0;
  const winner = p1Won ? p1 : p2;
  const loser = p1Won ? p2 : p1;
  const winnerUnit = p1Won ? unit1 : unit2;
  const loserUnit = p1Won ? unit2 : unit1;
  const remainingPct = Math.round(((p1Won ? hp1 : hp2) / (p1Won ? maxHp1 : maxHp2)) * 100);

  loserUnit.classList.add("fainted");
  winnerUnit.classList.add("winner");
  burstConfetti(stage);

  if (winner.cries?.latest) {
    const cry = new Audio(winner.cries.latest);
    cry.volume = 0.3;
    cry.play().catch(() => {});
  }

  winnerBanner.innerHTML = `
    <div class="winner-info">
      <div class="trophy-badge">🏆</div>
      <div>
        <span class="winner-sub">VENCEDOR EM ${turnCount} TURNOS · ${remainingPct}% HP RESTANTE</span>
        <div class="winner-title">${winner.name} derrotou ${loser.name}!</div>
      </div>
    </div>
  `;
  winnerBanner.classList.remove("hidden");

  logEl.innerHTML = `Fim de combate! <strong>${winner.name}</strong> venceu a batalha.`;
  startBtn.disabled = false;
  startBtn.textContent = "↻ Revanche";
  appState.isFighting = false;
}

/* =========================================================
   INSPETOR BIOMÉTRICO
   ========================================================= */
function buildHumanScaleSvg(heightMeters) {
  const humanH = 1.75;
  const maxRef = Math.max(humanH, heightMeters, 1.8);
  const maxBarPx = 56;

  const humanPx = Math.max(12, Math.round((humanH / maxRef) * maxBarPx));
  const pokePx = Math.max(8, Math.round((heightMeters / maxRef) * maxBarPx));

  return `
    <svg width="96" height="68" viewBox="0 0 96 68" aria-label="Comparação de altura com humano">
      <line x1="8" y1="62" x2="88" y2="62" stroke="#d6cfa8" stroke-width="1.5" />
      <rect x="22" y="${62 - humanPx}" width="14" height="${humanPx}" rx="4" fill="#e4e4e7" />
      <circle cx="29" cy="${62 - humanPx - 5}" r="3.5" fill="#e4e4e7" />
      <rect x="56" y="${62 - pokePx}" width="18" height="${pokePx}" rx="5" fill="#fde047" stroke="#18181b" stroke-width="1.2" />
    </svg>
  `;
}

async function openInspector(idOrName) {
  const body = document.getElementById("inspector-body");
  body.innerHTML = `<p class="empty-hint">Lendo biometria da espécie...</p>`;

  try {
    const { data, source } = await catalogService.getByQuery(idOrName);
    appState.selectedPokemon = data;
    appState.visualMode = "artwork";

    renderInspectorContent(data, source);

    document.querySelectorAll(".poke-card-3d").forEach((c) => {
      c.classList.toggle("selected", Number(c.dataset.id) === data.id);
    });
  } catch {
    body.innerHTML = `<div class="error-strip">Falha ao carregar dados deste Pokémon.</div>`;
  }
}

async function renderInspectorContent(pokemon, source) {
  const pill = document.getElementById("source-pill");
  pill.textContent = source === "CACHE" ? "⚡ CACHE" : "🌐 API V2";
  pill.classList.remove("hidden");

  const isFav = favoritesService.has(pokemon.id);
  const isInArena = isPokemonInArena(pokemon.id);

  const heightM = pokemon.height / 10;
  const weightKg = pokemon.weight / 10;
  const abilities = pokemon.abilities
    .map((a) => `${a.ability.name.replace("-", " ")}${a.is_hidden ? " ★" : ""}`)
    .join(", ");

  const typesHtml = pokemon.types
    .map((t) => `<span class="type-tag">${PT_TYPES[t.type.name] || t.type.name}</span>`)
    .join("");

  const statsHtml = pokemon.stats
    .map((s) => {
      const pct = Math.min(100, Math.round((s.base_stat / 200) * 100));
      return `
        <div class="stat-meter">
          <span class="meter-name">${PT_STATS[s.stat.name] || s.stat.name}</span>
          <span class="meter-val">${s.base_stat}</span>
          <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    })
    .join("");

  const cryUrl = pokemon.cries?.latest || "";

  const body = document.getElementById("inspector-body");
  body.innerHTML = `
    <div class="specimen-stage">
      <div class="specimen-main">
        <img
          id="specimen-artwork"
          class="specimen-img ${appState.visualMode === "pixel" ? "pixel-mode" : ""}"
          src="${getArtworkUrl(pokemon, appState.visualMode)}"
          alt="${pokemon.name}"
        />
        <div>
          <span class="micro-code">${padId(pokemon.id)}</span>
          <h3 class="specimen-title">${pokemon.name}</h3>
          <span class="specimen-genus" id="specimen-genus">Analisando espécie...</span>
          <div class="type-tags">${typesHtml}</div>
        </div>
      </div>

      <div class="stage-controls">
        <button type="button" class="chip-toggle ${appState.visualMode === "artwork" ? "active" : ""}" data-vmode="artwork">Arte</button>
        <button type="button" class="chip-toggle ${appState.visualMode === "shiny" ? "active" : ""}" data-vmode="shiny">✨ Shiny</button>
        <button type="button" class="chip-toggle ${appState.visualMode === "pixel" ? "active" : ""}" data-vmode="pixel">8-Bit</button>
        ${
          cryUrl
            ? `<button type="button" id="play-cry-btn" class="chip-toggle" title="Ouvir vocalização">
                <span class="eq-bars"><i></i><i></i><i></i></span> Cry
              </button>`
            : ""
        }
      </div>
    </div>

    <div class="duo-actions">
      <button type="button" id="btn-fav-toggle" class="btn btn-sm ${isFav ? "btn-pastel" : "btn-white"}">
        ${isFav ? "★ Na Coleção" : "☆ Favoritar"}
      </button>
      <button type="button" id="btn-arena-toggle" class="btn btn-sm ${isInArena ? "btn-pastel" : "btn-white"}">
        ${isInArena ? "✓ Na Arena" : "⚔️ Enviar p/ Arena"}
      </button>
    </div>

    <div class="biometric-row">
      <div class="scale-card" title="Proporção comparada a um humano de 1,75 m">
        ${buildHumanScaleSvg(heightM)}
        <span class="scale-caption">Escala 1,75m vs ${heightM.toFixed(1).replace(".", ",")}m</span>
      </div>

      <div class="data-cells">
        <div class="data-cell">
          <span class="cell-lbl">Altura</span>
          <span class="cell-val">${heightM.toFixed(1).replace(".", ",")} m</span>
        </div>
        <div class="data-cell">
          <span class="cell-lbl">Peso</span>
          <span class="cell-val">${weightKg.toFixed(1).replace(".", ",")} kg</span>
        </div>
        <div class="data-cell full-span">
          <span class="cell-lbl">Habilidades (★ Oculta)</span>
          <span class="cell-val">${abilities}</span>
        </div>
      </div>
    </div>

    <div class="stats-block">
      <div class="block-head">
        <span class="micro-code">ATRIBUTOS BASE</span>
        <span class="micro-code">BST ${pokemon.stats.reduce((a, s) => a + s.base_stat, 0)}</span>
      </div>
      ${statsHtml}
    </div>

    <div class="evo-strip">
      <span class="micro-code">LINHA EVOLUTIVA</span>
      <div class="evo-pills" id="evo-chain-pills">
        <span class="empty-hint">Mapeando estágios...</span>
      </div>
    </div>
  `;

  body.querySelectorAll("[data-vmode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.visualMode = btn.dataset.vmode;
      const img = document.getElementById("specimen-artwork");
      img.src = getArtworkUrl(pokemon, appState.visualMode);
      img.classList.toggle("pixel-mode", appState.visualMode === "pixel");
      body.querySelectorAll("[data-vmode]").forEach((b) =>
        b.classList.toggle("active", b.dataset.vmode === appState.visualMode)
      );
    });
  });

  if (cryUrl) {
    const cryBtn = document.getElementById("play-cry-btn");
    cryBtn.addEventListener("click", () => {
      const audio = new Audio(cryUrl);
      audio.volume = 0.35;
      cryBtn.classList.add("playing");
      audio.play().catch(() => cryBtn.classList.remove("playing"));
      audio.addEventListener("ended", () => cryBtn.classList.remove("playing"));
    });
  }

  document.getElementById("btn-fav-toggle").addEventListener("click", () => {
    const saved = favoritesService.toggle(pokemon);
    showToast(saved ? `${pokemon.name} salvo na coleção.` : `${pokemon.name} removido.`);
    renderFavoritesDock();
    renderInspectorContent(pokemon, "CACHE");
  });

  document.getElementById("btn-arena-toggle").addEventListener("click", () => {
    toggleArenaPokemon(pokemon);
  });

  try {
    const info = await speciesService.getEnrichedSpecies(pokemon.species.url);
    document.getElementById("specimen-genus").textContent = `${info.genus} · Captura ${info.captureRate}`;

    const evoBox = document.getElementById("evo-chain-pills");
    if (info.evolutions.length > 0) {
      evoBox.innerHTML = info.evolutions
        .map((name, idx) => {
          const active = name === pokemon.name ? "current" : "";
          const arrow = idx < info.evolutions.length - 1 ? `<span>→</span>` : "";
          return `<button type="button" class="evo-btn ${active}" data-evo="${name}">${name}</button>${arrow}`;
        })
        .join("");

      evoBox.querySelectorAll(".evo-btn").forEach((b) => {
        b.addEventListener("click", () => openInspector(b.dataset.evo));
      });
    } else {
      evoBox.innerHTML = `<span class="empty-hint">Sem evoluções registradas.</span>`;
    }
  } catch {
    document.getElementById("specimen-genus").textContent = "Espécie catalogada";
  }
}

/* =========================================================
   COLEÇÃO DE FAVORITOS
   ========================================================= */
function renderFavoritesDock() {
  const items = favoritesService.all();
  const container = document.getElementById("favorites-body");
  document.getElementById("fav-count").textContent = String(items.length);

  if (items.length === 0) {
    container.innerHTML = `<p class="empty-hint">Nenhum favorito salvo ainda. Use ☆ na ficha biométrica.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="fav-grid">
      ${items
        .map(
          (f) => `
          <div class="fav-chip" data-id="${f.id}">
            <img src="${f.sprite}" alt="${f.name}" />
            <span>${f.name}</span>
            <span class="del-x" data-del="${f.id}" title="Remover">×</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll(".fav-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      if (e.target.dataset.del) {
        const id = Number(e.target.dataset.del);
        favoritesService.remove(id);
        renderFavoritesDock();
        if (appState.selectedPokemon?.id === id) {
          renderInspectorContent(appState.selectedPokemon, "CACHE");
        }
        return;
      }
      openInspector(chip.dataset.id);
    });
  });
}

/* =========================================================
   COMMAND PALETTE (CTRL + K) & EVENTOS GERAIS
   ========================================================= */
function initCommandPalette() {
  const backdrop = document.getElementById("cmd-backdrop");
  const input = document.getElementById("cmd-input");
  const results = document.getElementById("cmd-results");

  const quickCommands = [
    { label: "⚡ Iniciar Duelo Rápido Aleatório", hint: "Arena", run: () => triggerQuickDuel() },
    { label: "⚄ Sortear Pokémon aleatório", hint: "Explorar", run: () => triggerRandom() },
    { label: "⚡ Inspecionar Pikachu (#025)", hint: "Pokémon", run: () => openInspector(25) },
    { label: "💧 Inspecionar Blastoise (#009)", hint: "Pokémon", run: () => openInspector(9) },
    { label: "🔥 Inspecionar Charizard (#006)", hint: "Pokémon", run: () => openInspector(6) },
    {
      label: "🔌 Alternar Simulação de Falha API",
      hint: "Resiliência",
      run: () => document.getElementById("fault-toggle-btn").click(),
    },
  ];

  function renderOptions(term = "") {
    const clean = term.trim().toLowerCase();
    const filtered = quickCommands.filter((c) => c.label.toLowerCase().includes(clean));

    const customSearch = clean
      ? `<button type="button" class="cmd-option" id="cmd-direct-search">
          <span>Buscar "${term}" na PokéAPI</span>
          <span class="hint">Enter ↵</span>
        </button>`
      : "";

    results.innerHTML =
      customSearch +
      filtered
        .map(
          (cmd, i) => `
          <button type="button" class="cmd-option" data-cmd-idx="${i}">
            <span>${cmd.label}</span>
            <span class="hint">${cmd.hint}</span>
          </button>
        `
        )
        .join("");

    document.getElementById("cmd-direct-search")?.addEventListener("click", () => {
      closeModal();
      runSearch(term);
    });

    results.querySelectorAll("[data-cmd-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = filtered[Number(btn.dataset.cmdIdx)];
        closeModal();
        cmd?.run();
      });
    });
  }

  function openModal() {
    backdrop.classList.remove("hidden");
    input.value = "";
    renderOptions();
    input.focus();
  }

  function closeModal() {
    backdrop.classList.add("hidden");
  }

  document.getElementById("open-cmd-btn").addEventListener("click", openModal);
  document.getElementById("close-cmd-btn").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  input.addEventListener("input", () => renderOptions(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      const val = input.value.trim();
      closeModal();
      runSearch(val);
    } else if (e.key === "Escape") {
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      backdrop.classList.contains("hidden") ? openModal() : closeModal();
    }
  });
}

async function runSearch(query) {
  const clean = query.trim();
  if (!clean) return loadCatalog(1);

  showCatalogError("");
  renderSkeletons(1);
  document.getElementById("pagination-bar").classList.add("hidden");

  try {
    const { data, source } = await catalogService.getByQuery(clean);
    renderCards([data]);
    document.getElementById("results-caption").textContent = "1 encontrado";
    appState.selectedPokemon = data;
    appState.visualMode = "artwork";
    renderInspectorContent(data, source);
  } catch {
    document.getElementById("pokemon-grid").innerHTML = "";
    document.getElementById("results-caption").textContent = "0 encontrados";
    showCatalogError(
      gateway.simulateOffline
        ? "Erro 503 simulado no Gateway. Clique em 'API Online' no topo para restaurar."
        : `Nenhuma espécie encontrada para "${clean}".`
    );
  }
}

async function triggerRandom() {
  try {
    const { data, source } = await catalogService.getRandom();
    appState.selectedPokemon = data;
    appState.visualMode = "artwork";
    renderInspectorContent(data, source);
    showToast(`Espécie sorteada: ${padId(data.id)} ${data.name}`);
  } catch {
    showToast("Não foi possível sortear agora.");
  }
}

async function triggerQuickDuel() {
  try {
    const id1 = Math.floor(Math.random() * 650) + 1;
    let id2 = Math.floor(Math.random() * 650) + 1;
    if (id2 === id1) id2 = id1 + 1;

    const [res1, res2] = await Promise.all([
      catalogService.getByQuery(id1),
      catalogService.getByQuery(id2),
    ]);

    appState.battleSessionId++;
    appState.isFighting = false;
    appState.arenaTab = "battle";
    appState.arenaSlots = [res1.data, res2.data];
    renderArena();
    syncAllArenaBadges();
    runAnimatedBattle(res1.data, res2.data);
  } catch {
    showToast("Erro ao preparar duelo rápido.");
  }
}

/* =========================================================
   BOOT DA APLICAÇÃO
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initCommandPalette();
  renderFavoritesDock();
  renderArena();
  loadCatalog(1);
  openInspector(25);

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".slot-empty-wrap")) {
      document.querySelectorAll(".slot-dropdown").forEach((d) => d.classList.add("hidden"));
    }
  });

  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search-btn");

  searchInput.addEventListener("input", () => {
    clearBtn.classList.toggle("hidden", searchInput.value.trim() === "");
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.add("hidden");
    loadCatalog(1);
  });

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(searchInput.value);
  });

  document.getElementById("random-btn").addEventListener("click", triggerRandom);
  document.getElementById("quick-duel-btn").addEventListener("click", triggerQuickDuel);

  document.querySelectorAll(".type-chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-chip-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      searchInput.value = "";
      clearBtn.classList.add("hidden");
      appState.activeType = btn.dataset.type;
      loadCatalog(1);
    });
  });

  document.getElementById("prev-btn").addEventListener("click", () => {
    if (appState.currentPage > 1) loadCatalog(appState.currentPage - 1);
  });

  document.getElementById("next-btn").addEventListener("click", () => {
    if (appState.currentPage < appState.totalPages) loadCatalog(appState.currentPage + 1);
  });

  document.getElementById("clear-compare-btn").addEventListener("click", () => {
    appState.battleSessionId++;
    appState.isFighting = false;
    appState.arenaSlots = [null, null];
    renderArena();
    syncAllArenaBadges();
  });

  const faultBtn = document.getElementById("fault-toggle-btn");
  const faultLabel = document.getElementById("fault-label");
  faultBtn.addEventListener("click", () => {
    gateway.simulateOffline = !gateway.simulateOffline;
    faultBtn.classList.toggle("offline", gateway.simulateOffline);
    faultLabel.textContent = gateway.simulateOffline ? "Simulando 503" : "API Online";
    showToast(
      gateway.simulateOffline
        ? "Modo de falha HTTP 503 ativado no Gateway."
        : "Conexão normal com a PokéAPI restaurada."
    );
  });
});