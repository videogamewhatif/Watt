// Tarjetas FICTICIAS de la demostración. Solo se guardan marca y terminación;
// nadie escribe números de tarjeta en Wattalis. La terminación decide cómo
// responde la pasarela simulada al cobrar.
export type TestCard = {
  key: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  behavior: "approve" | "decline";
  description: string;
};

export const TEST_CARDS: TestCard[] = [
  { key: "visa_4242", brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030, behavior: "approve", description: "Aprueba todos los cobros" },
  { key: "mc_4444", brand: "Mastercard", last4: "4444", expMonth: 8, expYear: 2029, behavior: "approve", description: "Aprueba todos los cobros" },
  { key: "amex_8431", brand: "American Express", last4: "8431", expMonth: 3, expYear: 2031, behavior: "approve", description: "Aprueba todos los cobros" },
  { key: "visa_0002", brand: "Visa", last4: "0002", expMonth: 5, expYear: 2030, behavior: "decline", description: "Rechaza los cobros (fondos insuficientes simulados)" },
];

export function findTestCard(key: string): TestCard | null {
  return TEST_CARDS.find((c) => c.key === key) ?? null;
}

export function testCardLabel(m: { brand: string; last4: string }) {
  return `Tarjeta de prueba ${m.brand} terminación ${m.last4}`;
}
