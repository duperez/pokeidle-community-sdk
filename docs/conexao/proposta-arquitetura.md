# Proposta de arquitetura do conector standalone

## Status, escopo e evidência

Proposta para discussão e implementação, não descrição de funcionalidade já entregue.
Base examinada: `cd3261d996db9b1f8ea7cacf81ac53fe026667f9`; HEAD confirmado nessa revisão,
com worktree limpo antes da criação deste documento. Nenhum runtime foi alterado.

Recomendação: um runtime por documento/realm MAIN, instalado explicitamente no
`document_start`, com um hook, um parser, um estado canônico e um coordenador de
ações. Clientes são fachadas com assinaturas, erros e diagnósticos próprios.
Login, conexão, reconexão e fechamento do WebSocket pertencem ao jogo.
Contas, perfis, janelas, persistência de orçamento e automação pertencem ao host.

Este incremento deve compartilhar de fato entre duas cópias compatíveis no mesmo
global MAIN, não somente entre imports de um módulo. Não cobre globals diferentes,
iframes, isolated worlds, processos ou origens de extensões. Uma futura ponte
isolated-to-MAIN adaptará operações deste runtime; não será outro mecanismo
de WebSocket nem uma opção pública de transporte.

Evidência da base:

| Local | Comportamento relevante |
| --- | --- |
| `packages/sdk/src/page-transport.ts:17,74-76,97-139` | Rendezvous por símbolo global; adoção por constructor/send; socket anterior silenciado; versão existente não validada. |
| `packages/sdk/src/client.ts:53-60,193-210` | Cada cliente cria estado/Actions e faz parsing próprio. Compartilhar só o hook não satisfaz o objetivo. |
| `packages/sdk/src/client.ts:66-111` | start/stop idempotentes e proteção por execução; stale no open/close, não imediatamente ao adotar sucessor CONNECTING. |
| `packages/sdk/src/client.ts:245-256` | Exceções isoladas, mas listeners recebem o mesmo objeto mutável. |
| `packages/sdk/src/state.ts:49-60,99-103` | Cópias privadas congeladas já existem; markStale conserva valores antigos. |
| `packages/sdk/src/actions.ts:39-55,181-225` | inFlight, floors, limites e ledger são por Actions; listeners são armados antes do envio e onSend precede resultado terminal. |
| `packages/sdk/src/confirmations.ts:28-113,117-169` | Evidência por evento/inventário sem request id; não representa recibo transacional. |
| `examples/test-extension/manifest.json:7-13` | Extensão independente já declara MAIN/document_start. |

## API pública proposta

Os nomes abaixo são propostos; devem ser congelados antes da implementação.
Manter `PokeIdleClient` e APIs de domínio existentes reduz a migração.

```ts
// Executar no MAIN/document_start, mesmo que a interface só monte depois.
import { bootstrapPageSession, PokeIdleClient } from 'pokeidle-community-sdk';

bootstrapPageSession();

const client = new PokeIdleClient({ onError: handleSdkError });
const off = client.state.onChange(() => render(client.state));
client.start();

if (client.connected && client.state.complete) {
  // Valores atuais desta geração, não confirmação de comando.
}

off();
client.stop(); // Não fecha socket, não para pares, não remove o runtime.
```

Contrato proposto:

| Superfície | Semântica |
| --- | --- |
| `bootstrapPageSession(options?): void` | Instala/adota runtime cedo; idempotente para configuração normalizada igual. Não retorna socket nem runtime mutável. |
| `new PokeIdleClient(options?)` | Cria somente fachada parada; sem hook, DOM, conexão ou assinatura global. Aceita `onError` e `inspector` locais. |
| `start(): void` | Attach síncrono e idempotente. Se faltou bootstrap, instala com defaults; isso não recupera tráfego perdido. Falhas de contexto/versão/configuração são explícitas e deixam cliente parado. |
| `stop(): void` | Detach idempotente; connected/complete locais false antes de notificar. Valores locais ficam last-known; assinaturas explícitas sobrevivem para restart. |
| `connected: boolean` | Cliente iniciado e socket corrente OPEN. Não implica estado completo. |
| `generation: number` | Geração observada neste documento, 0 antes de adoção; metadado legível, não identificador global de conta. |
| `state.complete: boolean` | Snapshot completo coletado pelo runtime nesta geração e cliente attached. |
| `state` | View somente leitura, preservando getters e onChange; não expor `applyPacket`/`markStale` nessa view. |
| `actions` | Fachada vinculada ao consumidor; encaminha para coordenador único. Sem objeto Actions mutável compartilhado publicamente. |
| `sendCommand`/`sendRaw` | Sempre `Promise<boolean>`; true = aceito para envio, false = definitivamente não enviado por ausência de conexão/attach. Erros de validação continuam síncronos; falha incerta rejeita. |

O retorno uniforme assíncrono dos envios elimina o generic de transporte e evita
uma futura reescrita da API quando houver ponte. Não introduzir fila de comandos.
Uma Promise rejeitada não autoriza repetir um envio.

`BootstrapOptions` contém somente política compartilhada: `maxPacketBytes` e
`actions` (limites, checks, dryRun e tempos existentes, sem scheduler público).
Defaults são normalizados antes de comparar. Primeiro bootstrap fixa a política;
outro bootstrap com política diferente lança erro de configuração, sem alterar
pares. `start()` adota a política existente sem tentar reaplicar defaults.
Copiar e congelar opções aninhadas na entrada; mutação posterior do objeto do
consumidor não altera política, comparação ou comportamento de outro cliente.
Não admitir `actions`/`maxPacketBytes` por fachada nesta etapa: orçamento, cooldown
e floors não podem depender de quem venceu a corrida entre clientes.
`dryRun`/`onSend` por chamada continuam como hoje; limites duráveis ficam no host.
Relógio, PageLike e transporte fake permanecem seams internos de testes.

## Estrutura e ownership

```text
jogo -> WebSocket existente -> hook MAIN -> parse/validação -> estado canônico
                                             |                    |
                                             +-> reconciliação <-+
                                             |     única
                                             +-> fachadas A/B -> listeners locais
fachadas A/B -> guardas + coordenador único -> send original do socket corrente
```

O runtime usa um slot global estável, com ABI numérica explícita e capacidades
requeridas. Reutiliza-se o padrão de `Symbol.for` da base, não `instanceof` entre
bundles. A validação acontece antes de modificar constructor/prototype/global.
ABI e capacidades compatíveis reutilizam hook/parser/estado/coordenador; diferenças
de versão do pacote por si sós não implicam incompatibilidade. Incompatibilidade
gera erro tipado/controlado, sem substituir o slot nem empilhar proxies.
O slot legado de page-hook v1 também deve ser detectado: falhar explicitamente
se não puder ser adotado com segurança, não instalar um segundo hook ao lado dele.

Não desfazer patch quando o último consumidor parar: o runtime continua coletando
estado para attach tardio. Guardar somente estado atual/last-known, contadores
limitados e reconciliação pendente; não um histórico bruto de pacotes.
Na destruição do documento todo o runtime é descartado; não persistir contas.

Fachadas não recebem o `GameState` mutável canônico. Pode-se reutilizar getters
existentes numa view delegada; stop retém um snapshot congelado local.
Estado e eventos são profundamente imutáveis antes de chegar a código consumidor;
um mesmo payload congelado pode ser compartilhado sem clone por listener.
Actions atualiza sua reconciliação antes de observadores externos.
Aplicação de estado e invalidação devem concluir antes da primeira notificação,
inclusive durante callbacks reentrantes. Cada entrega verifica attach/run atual:
um listener que para outro cliente não permite callback posterior daquele run.
Erros locais seguem onError daquele cliente; erro do handler não interrompe pares.
Não usar o onError de um cliente como proprietário global de falhas de runtime.

## Lifecycle e gerações

Geração identifica adoção de socket, não número de clientes. Attach/run identifica
execução da fachada. Capturas e waiters verificam ambos quando aplicável.
Antes de qualquer callback de fronteira, trocar geração/socket, invalidar complete
e finalizar reconciliação afetada. Só então notificar estado/conexão.

| Evento | Runtime/geração | Fachada e ações |
| --- | --- | --- |
| Constructor de cliente | Nenhuma alteração global | Parado, disconnected, incompleto. |
| Bootstrap sem socket | Hook instalado, estado incompleto | Pode haver zero clientes; não abre conexão. |
| Socket elegível novo, ainda CONNECTING | Geração avança imediatamente; complete false; socket anterior perde autoridade | Observadores nunca veem dados anteriores como atuais; pendências antigas não migram. |
| OPEN do socket corrente | Mesma geração; connected true; não restaura complete | Ações retornam no-state até estado completo válido. |
| `welcome` válido e completo | Aplica estado/catálogos antes de notificar; complete true | Ações podem usar essa geração. Welcome parcial/malformado não fabrica complete. |
| Attach após bootstrap coletar welcome + deltas | Não reinicia geração nem parsing | View imediatamente atual; não sintetiza evento welcome nem reenvia eventos históricos. |
| Attach sem welcome coletado | Socket pode estar OPEN; complete false | Só valores parciais reais; recuperação via próximo welcome/reload pelo host/jogo, sem login/query automática. |
| Socket preexistente antes do hook | Adota no primeiro send observado, se não houver sucessor vivo | Não há enumeração mágica de sockets nem recuperação do welcome perdido. |
| Mensagem/open/close/send de socket substituído | Ignora para estado/eventos/adoção | Não ressuscita geração nem desconecta sucessor. |
| CLOSE do corrente | complete false, connected false antes de notificar | Pendências possivelmente enviadas terminam unconfirmed, salvo evidência já conclusiva segundo regra existente. |
| stop de A, B permanece | Runtime e geração intactos | A stale/disconnected; B continua atual; só ação pertencente a A é cancelada localmente. |
| stop de último consumidor | Hook, parser e coleta continuam | Não fecha socket; libera assinaturas internas das fachadas, não histórico de limites/risco. |
| restart de A | Adota estado atual do runtime se completo na geração corrente | Não reaproveita callbacks antigos; nenhuma repetição de comando. |
| Nova navegação/documento | Novo runtime e nova identidade de sessão | Nenhum estado/pendência da página anterior é atual. |

Preservar o filtro de host da página e path `/`, com esquemas WebSocket válidos;
não passar a aceitar qualquer socket do documento. Constructor deve preservar
argumentos, protocolos, constantes, subclassing, identidade dos objetos retornados
e exceções nativas. Adoção por send continua sendo backstop, não mecanismo de login.

## Comandos concorrentes e evidência

Um coordenador controla inFlight, floors e cooldown para todo o runtime, com
limiter e ledger únicos sob a política de bootstrap. Fachadas apenas identificam
o dono da chamada e encaminham observers locais. Uma ação de B enquanto A está
pendente retorna busy; não fica em fila e não ganha retry automático.

Stop do dono depois de envio aceito/incerto não desfaz o comando: resolve a chamada
sem evidência como unconfirmed, preserva floors e inicia cooldown compartilhado.
Se já existe evidência conclusiva, preservar o resultado que ela permite.
Stop antes do dispatch impede envio. Essa decisão não emite desconexão para pares.
Nenhum attach/stop reinicia ledger/limiter; só troca de geração limpa floors,
preservando cooldown e orçamento em memória.

Enviar via low-level não pode contornar uma ação pendente: `sendCommand`/`sendRaw`
de consumidor recusam com erro busy explícito; não retornar false com significado
errado. O envio interno da ação usa sua própria reserva, sem deadlock.
Cada envio imediato usa a geração/reserva capturada, sem reter comando para OPEN.

Low-level e comandos manuais do jogo continuam sem receipt correlacionável.
Como regra conservadora mínima, envio low-level aceito/incerto marca evidência
externa na geração; raw é opaco e sempre marca. Envio observado do jogo durante
uma ação também marca interferência para essa reconciliação. Nesse caso, não
confirmar por delta de inventário/remoção isolada e nunca elevar evento ambíguo a
certain: um evento compatível pode no máximo ser probable. A marca conservadora
de low-level dura até troca de geração; não criar catálogo especulativo de efeitos.
Envios normais do jogo não são bloqueados, alterados ou repetidos pelo SDK.
Mesmo sem interferência observada, certain continua significando correspondência
pela regra existente, nunca prova transacional. Escritas externas não observáveis
não podem ser excluídas pelo SDK.

Armar listeners antes do envio; reservar floors/limites antes do onSend. Preservar
accepted/not-sent/uncertain e onSend exatamente uma vez, antes do resultado terminal,
mesmo com resposta síncrona ou observer que lança. Nunca converter erro incerto em
not-sent. Nenhuma geração nova pode fornecer evidência a uma ação da anterior.

## Alternativa rejeitada e migração

| Opção | Consequência | Decisão |
| --- | --- | --- |
| Runtime MAIN único com fachadas e política compartilhada | Menos flexibilidade por cliente, mas readiness tardia e serialização coerentes; ponte futura usa o mesmo proprietário. | Recomendada para este incremento. |
| Apenas factory sem transport público, conservando parser/estado/Actions por cliente | Migração inicial menor, mas duplica CPU, perde welcome antes de attach e permite duas ações independentes sobre a mesma evidência. | Rejeitada: não entrega compartilhamento comprometido. |

Não adicionar broker cross-extension, daemon, worker obrigatório ou outro repo.
A ponte futura usará attach/detach, snapshot/eventos e pedidos/resultados com
identidade de documento/geração e correlação interna; callbacks e erros arbitrários
não atravessam IPC. A correlação de IPC não cria request id no protocolo do jogo.
Seu isolamento/autorização é trabalho posterior; não prometer segurança entre
extensões que executam juntas em MAIN.

A futura integração do launcher consumirá fatos/getters já normalizados e
resultados de ações do cliente da página. Uma projeção serializável combina
geração, conexão, complete e somente os fatos necessários ao host; não espelhar
frames para outro PokeIdleClient no main nem reaplicar o protocolo fora da página.
O host associa identidade de documento ao seu espelho para não confundir gerações
numéricas de navegações diferentes. O futuro adaptador encaminha apenas ações
permitidas e preserva onSend separado do terminal. A instalação antecipada que
falha não habilita fallback CDP; o hook de envio duplicado do host deverá sair.
Isto é uma restrição de integração, não implementação de IPC/Electron neste plano.

Remover exports e exemplos públicos de Transport/PageTransport/PageLike/SendResult,
o generic de PokeIdleClient e as instruções de CDP/transporte customizado.
Mover opções globais do constructor para bootstrap; atualizar consumidores de
send boolean para await. Alterar client.state para view readonly sem mutadores.
Documentar que restart pode agora reutilizar estado completo contínuo do runtime,
diferentemente da base. Atualizar README, package README, architecture, CHANGELOG,
snapshot de API, testes, extensão e verificadores de distribuição no mesmo incremento.
Não manter fallback legado silencioso. Migração do launcher vem após prova standalone,
por SHA exato e com a mesma política de página, sem segundo transporte público.

## Matriz de aceite e execução

| Caso | Prova mínima exigida |
| --- | --- |
| Bootstrap/construção | Constructor não instala hook; bootstrap em MAIN antes do jogo captura welcome sem cliente; duas chamadas iguais não repatcham. |
| Filtro/constructor | Host/path/esquema, protocolos, instanceof/subclasse, constantes e throws nativos; sockets alheios intactos. |
| Adoção/attach tardio | Socket antigo adotado no send; attach com/sem welcome; dois clientes leem mesmo estado sem duplicar parse/apply. |
| Geração | Sucessor CONNECTING invalida antes de callbacks; eventos velhos ignorados; welcome posterior não confirma ordem antiga. |
| stop/restart | A não para B; snapshot parado stale; restart usa geração atual; zero consumidores mantém coleta; nenhum replay de comandos. |
| Bundles | Duas cópias compiladas independentes no mesmo MAIN compartilham; incompatibilidade/slot legado/config divergente falham sem repatch. |
| Isolamento | Mutação aninhada de packet/battle/state não afeta pares; listener/onError/onSend que lança; stop reentrante impede callbacks antigos. |
| Concorrência | Duas ações competem pelo mesmo inFlight; floors/cooldown sobrevivem ao dono; low-level busy; manual/raw interferente não vira confirmação forte. |
| Send/reconciliação | Resposta imediata, false, accepted, throw incerto, rejeição, timeout, stop e disconnect; ordem onSend/terminal e budgets preservada. |
| Dados hostis/volume | JSON inválido, tipo inválido, frame grande e welcome grande válido; descarte observável por razão controlada, sem payload em diagnóstico. |
| Standalone real | Extensão/IIFE e jogo sintético locais: bootstrap cedo, welcome antes de attach, duas cópias compatíveis e sucessor; sem launcher/CDP/conta real. |

Fakes unitários não provam worlds de extensão. Exigir evidência sintética em
navegador para distribuição MAIN; se não demonstrada, registrar como não
demonstrada, nunca inferir de um teste Node/vm. Não iniciar navegador neste papel;
coordenador reserva janela serial para implementador/revisor.

Usar comandos existentes: `npm run test:sdk`, `npm run test:repo`,
`npm run typecheck`, `npm run lint`, `npm run distribution -- --require-clean`
e `npm run test:distribution`; selecionar testes menores durante red/green.
Atualização de API intencional: em `packages/sdk`,
`UPDATE_API_SNAPSHOT=1 npm test`. Não regenerar catálogos/protocolo via rede para
resolver a conexão. Diagnósticos automáticos counts-only com enums controlados,
limites de séries/bytes e sem packets, credenciais, texto DOM ou erros arbitrários.
Callbacks curtos não removem parsing do renderer; desempenho só com baseline,
condições equivalentes e repetições, sem thresholds universais inventados.

## Decisões mínimas para congelamento

1. Compartilhamento real no mesmo MAIN/global; isolated worlds explicitamente fora deste incremento.
2. Bootstrap explícito precoce, constructor inerte e start como attach com fallback local de defaults.
3. Política única no bootstrap, não Actions/options independentes por fachada.
4. Geração avança na adoção, inclusive CONNECTING; restart pode adotar snapshot continuamente coletado.
5. View/eventos imutáveis e coordenação única de ações, inclusive risco preservado após stop.
6. Envios Promise, busy explícito e evidência conservadora diante de interferência.

Nomes exatos dos novos erros e forma interna da view são escolhas de implementação;
não precisam de nova abstração pública. Nenhuma pergunta funcional impede o plano:
o coordenador arbitra divergências concretas destes seis pontos em até duas rodadas.
Próximo passo executável: implementador escreve casos red de bootstrap tardio,
sucessor CONNECTING, duas cópias e ação concorrente; implementa o runtime mínimo
e só então atualiza API/docs/distribuição.

Neste trabalho foram lidos os três briefings e os arquivos citados; executados
`git rev-parse HEAD`, `git status --short` e inspeção de fontes/manifests/testes.
Também foi lida via `git show` a matriz independente de
`9dd6e21e9ad4b8ad02e4c8e2d76704dc10c9623c:docs/conexao/revisao.md`; os critérios
A1-A12 são compatíveis com esta proposta, sem reivindicar execução dos testes
relatados naquela outra sessão.
Skill `blueprint` usada para fronteiras, ownership e lifecycle; skill
`verification-before-completion` usada para conferir escopo e evidência do
checkpoint documental. Não foram executados testes de runtime nem navegador
por esta sessão: o entregável é exclusivamente a proposta.
