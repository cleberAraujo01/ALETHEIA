/**
 * Artefato de captura — a entrada do Diff Engine.
 *
 * Uma captura é a observação de uma build da aplicação: o que o DOM mostrava,
 * o que trafegou na rede, o que apareceu no console. O Diff Engine nunca fala
 * com um browser; ele consome capturas. Isso mantém o motor puro e testável
 * contra corpus versionado (§7 do CLAUDE.md).
 */

export const CAPTURE_VERSION = "0.4.0";

/**
 * Versões de captura que esta build do motor sabe ler.
 *
 * `0.1.0` não tem screenshot; é lida normalmente e a camada visual aparece
 * como lacuna declarada no relatório. `0.2.0` não tem `interruption` (a jornada
 * era só rotas; não havia como ser interrompida) e é lida como não
 * interrompida. Rejeitar versão antiga invalidaria o corpus de referência já
 * coletado, que é o ativo mais caro do projeto.
 */
export const SUPPORTED_CAPTURE_VERSIONS: readonly string[] = ["0.1.0", "0.2.0", "0.3.0", "0.4.0"];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface Capture {
  readonly captureVersion: string;
  readonly captureId: string;
  readonly target: CaptureTarget;
  readonly observations: readonly Observation[];
  /**
   * A jornada parou antes do fim? Um passo que falha (alvo sumiu, ação
   * recusada) interrompe a jornada e as observações seguintes NÃO EXISTEM nesta
   * captura. Isto tem de estar no artefato, não só no log: é o Diff Engine que
   * precisa declarar no relatório que aquelas observações não foram comparadas
   * (PA-10) — e, quando só o head parou, é sinal, não lacuna.
   */
  readonly interruption: CaptureInterruption | null;
}

export interface CaptureInterruption {
  readonly stepId: string;
  readonly action: string;
  readonly reason: string;
  /** Observações que a jornada teria produzido depois do passo que falhou. */
  readonly missingObservationIds: readonly string[];
}

export interface CaptureTarget {
  /** Rótulo livre: normalmente "base" ou "head". */
  readonly label: string;
  readonly baseUrl: string;
  readonly commit: string | null;
  /** UTC ISO-8601. */
  readonly capturedAtUtc: string;
}

/**
 * Uma observação é um ponto comparável entre duas builds — tipicamente
 * "a tela X depois do passo Y".
 *
 * `observationId` é a chave semântica de alinhamento e precisa ser estável
 * entre base e head. Alinhar por índice de array seria exatamente o erro que
 * §12.4 proíbe ("não por índice — por identidade semântica").
 */
export interface Observation {
  readonly observationId: string;
  /** Rota normalizada, ex.: `/orders/:id`. */
  readonly route: string;
  readonly url: string;
  /** `null` = camada não capturada. Diferente de capturada e vazia. */
  readonly dom: DomNode | null;
  readonly network: readonly NetworkExchange[] | null;
  /**
   * Capturado como evidência (RN-EXE-003), mas ainda SEM camada de diff nesta
   * fase. A ausência é declarada no relatório como lacuna (RN-COB-003).
   */
  readonly console: readonly ConsoleEntry[] | null;
  readonly screenshot: ScreenshotRef | null;
  /**
   * Resultado das capabilities READ executadas neste ponto da jornada (O6,
   * §14). `null` = nenhuma sonda declarada; a camada de banco aparece como
   * lacuna declarada. Versões ≤ 0.3.0 não têm o campo e são lidas como `null`.
   */
  readonly database: readonly DatabaseObservation[] | null;
}

/**
 * Uma capability executada: colunas, linhas (valores JÁ mascarados na borda do
 * executor — RN-DAT-008), e o que o diff precisa para alinhar sem adivinhar:
 * `keyColumns` e `volatileColumns` vêm da própria capability.
 */
export interface DatabaseObservation {
  readonly capability: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly keyColumns: readonly string[];
  readonly volatileColumns: readonly string[];
  readonly maskedColumns: readonly string[];
  readonly durationMs: number;
  /** A capability falhou neste lado: o motivo, sem valores nem URL. */
  readonly error: string | null;
}

/**
 * Referência a uma imagem em disco. O motor nunca abre o arquivo — quem
 * decodifica é o shim, que entrega o raster já pronto.
 */
export interface ScreenshotRef {
  /** Caminho relativo ao arquivo de captura. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /**
   * Regiões sabidamente dinâmicas, excluídas da comparação: carrossel,
   * relógio, banner rotativo, mapa. Máscara é supressão declarada na origem —
   * quem capturou sabe o que é dinâmico ali —, e por isso aparece contada no
   * delta, nunca aplicada em silêncio.
   */
  readonly masks: readonly Rect[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DomNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** Texto direto do nó, sem os filhos. `null` quando não há. */
  readonly text: string | null;
  /** Papel de acessibilidade (AX tree via CDP). Sinal de identidade forte. */
  readonly role: string | null;
  /** Nome acessível computado. Sinal de identidade forte. */
  readonly accessibleName: string | null;
  readonly children: readonly DomNode[];
}

export interface NetworkExchange {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly resourceType: string;
  readonly requestBody: JsonValue | null;
  readonly responseBody: JsonValue | null;
  readonly durationMs: number | null;
}

export interface ConsoleEntry {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
}
