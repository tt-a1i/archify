export interface LocalizedText {
  en: string;
  zh: string;
}

export interface FeaturedPartner {
  id: 'kimi-work';
  name: LocalizedText;
  eyebrow: LocalizedText;
  status: LocalizedText;
  headline: LocalizedText;
  summary: LocalizedText;
  cta: LocalizedText;
  poster: string;
  posterAlt: LocalizedText;
  href: {
    en: string;
    zh: string;
  };
}

export interface SponsorItem {
  id: 'supercode' | 'openlux' | 'packycode' | 'aicodemirror' | 'zturbo' | 'infistar';
  index: string;
  name: LocalizedText;
  category: LocalizedText;
  summary: LocalizedText;
  highlight: LocalizedText;
  cta: LocalizedText;
  href: string;
}

export const featuredPartner: FeaturedPartner = {
  id: 'kimi-work',
  name: {
    en: 'Kimi Work',
    zh: 'Kimi Work',
  },
  eyebrow: {
    en: 'FEATURED COLLABORATION · ARCHIFY × KIMI WORK',
    zh: '旗舰合作 · ARCHIFY × KIMI WORK',
  },
  status: {
    en: 'OFFICIAL PLUGIN STORE',
    zh: '插件商店已上架',
  },
  headline: {
    en: 'Interactive Architecture Diagram in Kimi Work.',
    zh: '在 Kimi Work 插件商店，一句话生成可交互架构图。',
  },
  summary: {
    en: 'Find Archify in the Kimi Work plugin store as "Interactive Architecture Diagram". Describe your system in one sentence to create an interactive diagram directly inside your Kimi Work workspace.',
    zh: '在 Kimi Work 插件商店搜索「可交互架构图」，用一句话描述你的系统，即可直接生成可探索、可验证的交互式图。',
  },
  cta: {
    en: 'Try it in Kimi Work',
    zh: '在 Kimi Work 中使用',
  },
  poster: 'assets/sponsors/archify-kimi-work.webp',
  posterAlt: {
    en: 'Archify × Kimi Work collaboration banner',
    zh: 'Archify × Kimi Work 合作海报',
  },
  href: {
    en: 'https://www.kimi.ai/?aff=archify',
    zh: 'https://www.kimi.com/?aff=archify',
  },
};

/**
 * Strictly ordered to match the README.md / README_ZH.md sponsors table:
 * 1. Supercode
 * 2. OpenLux
 * 3. PackyCode
 * 4. AICodeMirror
 * 5. ZTURBO
 * 6. Infistar.cc
 */
export const sponsorsList: SponsorItem[] = [
  {
    id: 'supercode',
    index: '01',
    name: {
      en: 'Supercode',
      zh: 'Supercode',
    },
    category: {
      en: 'AGENT HARNESS & CURATED SKILLS',
      zh: '智能体增强与精选技能',
    },
    summary: {
      en: 'Supercode sponsors Archify and enhances Codex and Cursor with token optimization, curated Skills, and spec-driven development. Archify is featured as a Supercode Editor’s Choice skill.',
      zh: 'Supercode 赞助 Archify，通过 Token 优化、精选 Skills 和规范驱动开发增强 Codex 与 Cursor。Archify 已入选 Supercode Editor’s Choice 技能。',
    },
    highlight: {
      en: 'Supercode Editor’s Choice Skill',
      zh: '入选 Supercode Editor’s Choice 技能',
    },
    cta: {
      en: 'supercode.sh',
      zh: 'supercode.sh',
    },
    href: 'https://supercode.sh/?utm_source=archify',
  },
  {
    id: 'openlux',
    index: '02',
    name: {
      en: 'OpenLux',
      zh: 'OpenLux',
    },
    category: {
      en: 'ENTERPRISE AI PLATFORM',
      zh: '企业级一站式 AI 聚合平台',
    },
    summary: {
      en: 'An all-in-one AI platform for businesses bringing together Claude, OpenAI, and Gemini models from major providers with fast, reliable service and responsive technical support.',
      zh: '面向企业的一站式 AI 聚合平台，汇集 Claude、OpenAI、Gemini 等全球主流大模型，提供高效稳定的服务与及时的技术支持。',
    },
    highlight: {
      en: 'Exclusive · up to 7.5% off credit top-ups',
      zh: '专属福利 · 充值最高可享 7.5% 优惠',
    },
    cta: {
      en: 'Get started with OpenLux',
      zh: '立即体验 OpenLux',
    },
    href: 'https://www.openlux.ai/register?channel=c_qdvanbpc',
  },
  {
    id: 'packycode',
    index: '03',
    name: {
      en: 'PackyCode',
      zh: 'PackyCode',
    },
    category: {
      en: 'UNIFIED API & HIGH-SPEED ROUTES',
      zh: '统一密钥与智能容灾通道',
    },
    summary: {
      en: 'Access leading AI models through PackyCode with one API endpoint, one key, automatic failover, and dedicated high-speed routes for Codex and Claude Code.',
      zh: '提供统一域名、统一密钥和智能容灾切换，一句话接入主流大模型，配备专属 Codex / Claude Code 高速通道。',
    },
    highlight: {
      en: '$1 free credits · 1st top-up discount',
      zh: '新用户获 $1 体验额度 · 首充享折扣',
    },
    cta: {
      en: 'Get started with PackyCode',
      zh: '立即体验 PackyCode',
    },
    href: 'https://www.packyapi.ai/register?aff=bN97',
  },
  {
    id: 'aicodemirror',
    index: '04',
    name: {
      en: 'AICodeMirror',
      zh: 'AICodeMirror',
    },
    category: {
      en: 'ENTERPRISE CODING RELAY',
      zh: '企业级高并发 API 中转服务',
    },
    summary: {
      en: 'Provides API relay services for Claude, Codex, and Gemini with enterprise-grade concurrency, invoice issuance, and 24/7 technical support.',
      zh: '提供 Claude / Codex / Gemini API 中转服务，支持企业级高并发、合规开票和 7×24 小时技术支持。',
    },
    highlight: {
      en: '20% off your first top-up',
      zh: '专属链接注册享首充 8 折',
    },
    cta: {
      en: 'Try AICodeMirror',
      zh: '立即体验 AICodeMirror',
    },
    href: 'https://www.aicodemirror.ai/register?invitecode=WC26FL',
  },
  {
    id: 'zturbo',
    index: '05',
    name: {
      en: 'ZTURBO',
      zh: 'ZTURBO',
    },
    category: {
      en: 'HIGH-SPEED CONNECTIVITY',
      zh: '高速网络连接服务',
    },
    summary: {
      en: 'Fast, stable connectivity for developers and AI users across Windows, macOS, iOS, and Android.',
      zh: '为开发者和 AI 用户提供高速稳定的连接体验，支持 Windows、macOS、iOS 和 Android 多端使用。',
    },
    highlight: {
      en: 'Free trial · 1st top-up bonus',
      zh: '免费体验 · 首充加赠 · 多端畅连',
    },
    cta: {
      en: 'Try ZTURBO',
      zh: '立即体验 ZTURBO',
    },
    href: 'https://zturbo.top',
  },
  {
    id: 'infistar',
    index: '06',
    name: {
      en: 'Infistar.cc',
      zh: 'Infistar.cc 无限星河',
    },
    category: {
      en: 'MULTIMODAL CREATION API',
      zh: '全模态创作与大模型 API',
    },
    summary: {
      en: 'One API key covers text, image, and video creation with GPT, Claude, Gemini, DeepSeek, Qwen, Kling, and other models without switching groups.',
      zh: '一个 API Key 覆盖文案、图片与视频创作，支持 GPT、Claude、Gemini、DeepSeek、通义千问、可灵等主流模型，无需分组。',
    },
    highlight: {
      en: '$5 trial credits · first top-up offer',
      zh: '注册送 $5 体验金 · 享首充特惠',
    },
    cta: {
      en: 'Try Infistar',
      zh: '立即体验 Infistar',
    },
    href: 'https://www.infistar.cc/register?aff=9N89LEMV&ref_source=link',
  },
];
