/**
 * シード付き疑似乱数生成器(mulberry32)。
 *
 * オンライン対戦では「サーバーがシャッフルした結果をクライアントが
 * 検証できる」ようにしておきたいので、Math.random() ではなく
 * シード値から再現可能な乱数列を作れるようにしている。
 * (例: 対局終了後にシード値を公開し、牌山の生成が不正でなかったか
 *  クライアント側で再計算して確認できる)
 */
export type Rng = () => number; // 0以上1未満の乱数を返す関数

export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 対局開始時に使うランダムなシード値を作る。
 * ブラウザ・Node.js どちらでも動くよう crypto を優先し、
 * 使えない環境では Math.random() にフォールバックする。
 */
export function generateRandomSeed(): number {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const arr = new Uint32Array(1);
    cryptoObj.getRandomValues(arr);
    return arr[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}
