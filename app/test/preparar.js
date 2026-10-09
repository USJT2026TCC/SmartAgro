/**
 * Preparacao comum dos testes das telas.
 *
 * Testing Library desmonta cada tela ao fim do teste; o jest-dom nao e usado,
 * as conferencias sao feitas com os seletores da propria Testing Library.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
