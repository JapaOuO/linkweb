# LinkWeb — monitoramento da rede escolar

Estrutura inicial do aplicativo web para acompanhar ping, latência, jitter, perda de pacotes e disponibilidade dos pontos da rede escolar.

## Estrutura

- `frontend/`: painel web, componentes, páginas e integração com a API.
- `backend/`: API, autenticação, regras de negócio e persistência.
- `network-monitor/`: coleta ativa de métricas de rede e publicação dos resultados.
- `database/`: migrações e dados iniciais.
- `infra/`: configurações de execução, observabilidade e scripts operacionais.
- `docs/`: arquitetura, API e procedimentos operacionais.
- `tests/`: testes de integração e ponta a ponta.

## Protótipo implementado

- Backend em Python/FastAPI: `backend/`.
- Frontend React/Vite: `frontend/`.
- Firestore opcional para persistir medições.
- Monitoramento assíncrono por alvo, com intervalo configurável entre 1 segundo e 1 hora.
- Quantidade de pings por medição configurável entre 1 e 20.
- Medição de latência, perda de pacotes e jitter.
- Medição opcional de download/upload usando `speedtest-cli`.
- Coleta diretamente no tablet/notebook pelo navegador e envio online para a API/Firebase.
- Identificação do tipo de dispositivo (tablet, notebook ou desktop) e conexão (Wi-Fi ou cabeada).
- Latência medida contra o servidor principal de pesquisa do Google (`https://www.google.com/`).
- Dashboard com gráficos e filtros por tipo de dispositivo e conexão.

### Executar a API

```powershell
cd C:\PI4\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn src.main:app --reload
```

Deixe esse terminal aberto. Verifique a API acessando
`http://localhost:8000/health`; ela deve responder `{"status":"ok"}`.

### Executar o frontend

```powershell
cd frontend
npm install
npm run dev
```

O frontend usa `http://localhost:8000` por padrão. Se o frontend for aberto
em outro computador, tablet ou notebook, `localhost` aponta para esse próprio
dispositivo e não para o computador que executa a API. Nesse caso, execute a
API aceitando conexões da rede:

```powershell
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

Depois, crie `frontend/.env` com o IP do computador servidor:

```env
VITE_API_URL=http://192.168.1.100:8000
```

Substitua `192.168.1.100` pelo IP correto. Após alterar `.env`, reinicie o
Vite. Para uso pela internet, use a URL HTTPS pública da API no lugar do IP.

### Publicar na Vercel

A Vercel publica o frontend, mas não torna a API Python local pública. No
projeto da Vercel, configure **Root Directory** como `frontend` e use:

- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

Em **Settings > Environment Variables**, adicione:

```env
VITE_API_URL=https://sua-api-publica.example.com
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=webeduc-6e7ed.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=webeduc-6e7ed
VITE_FIREBASE_STORAGE_BUCKET=webeduc-6e7ed.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=900773527249
VITE_FIREBASE_APP_ID=1:900773527249:web:8b72a0df26f991b3734ff0
VITE_FIREBASE_MEASUREMENT_ID=G-5205ZYM91E
```

`VITE_API_URL` não pode ser `localhost` em produção. A API Python precisa ser
publicada separadamente em um serviço que execute FastAPI, como Cloud Run,
Render ou Railway. Configure nesse serviço:

```env
ALLOWED_ORIGINS=https://seu-projeto.vercel.app
FIREBASE_CREDENTIALS_JSON={...}
```

Use o JSON da conta de serviço somente no ambiente da API, nunca nas variáveis
`VITE_*` nem no frontend. Depois de configurar as variáveis, faça um novo
deploy, pois o Vite incorpora `VITE_*` durante o build.

Teste a API publicada antes de abrir o frontend:

```text
https://sua-api-publica.example.com/health
```

Ela deve responder `{"status":"ok"}`. Depois teste no navegador:

```text
https://seu-projeto.vercel.app
```

Para salvar medições no Firebase, copie `.env.example` para `.env` e informe
`FIREBASE_CREDENTIALS_FILE` com o caminho da chave de uma conta de serviço.

O frontend está preparado para o projeto Firebase `webeduc-6e7ed`. Copie
`frontend/.env.example` para `frontend/.env` antes de executar o Vite. A
configuração Web do Firebase (`apiKey`, `appId` e `projectId`) identifica o
projeto e pode ser enviada ao navegador; ela não substitui a credencial
administrativa do backend e não deve ser tratada como segredo.

Para o backend gravar medições nesse projeto, configure na API uma conta de
serviço do Firebase usando `FIREBASE_CREDENTIALS_FILE` ou
`FIREBASE_CREDENTIALS_JSON`. Nunca coloque o JSON da conta de serviço no
frontend.

### Regras do Firestore

As regras fornecidas inicialmente com `allow read, write: if true` deixam o
banco público: qualquer pessoa pode ler, alterar ou apagar dados. Elas não
devem ser usadas em produção.

O arquivo [firestore.rules](C:/PI4/firestore.rules) bloqueia o acesso direto
ao Firestore. O backend grava usando o Firebase Admin SDK, que opera no lado
servidor e não fica sujeito às regras do cliente. Publique essas regras:

```powershell
firebase deploy --only firestore:rules
```

Selecione o projeto `webeduc-6e7ed` durante `firebase login` e `firebase use`.
Com esse modelo, o navegador envia medições somente para a API Python. Antes
de publicar, a API também deve receber autenticação própria para impedir
envios falsos.

O comando de ping é executado no servidor da API, não diretamente no navegador.
Assim, os aparelhos precisam ser alcançáveis a partir desse servidor; para
monitorar várias escolas, o ideal é instalar um agente de coleta dentro de cada
rede e enviar as medições autenticadas para a API.

### Coleta diretamente nos tablets e notebooks

O frontend agora mede a conexão do próprio dispositivo através de requisições
HTTP à API online e envia cada resultado para `POST /api/client-measurements`.
Cada aparelho recebe um identificador persistente no navegador e pode ser
nomeado no painel. O intervalo entre 1 segundo e 1 hora é configurável.

Navegadores não podem executar ICMP/ping diretamente por restrições de segurança.
Por isso, a medição web usa uma requisição HTTP até o servidor principal de
pesquisa do Google (`https://www.google.com/`) e representa a latência da
conexão daquele dispositivo até esse serviço. Para ping ICMP real entre
aparelhos, será necessário um agente Python instalado na rede da escola.

O botão `Dashboard` abre a página de análise, com gráficos de latência, jitter,
download e upload, além de filtros por tablet/notebook/desktop e Wi-Fi/cabeada.

Deploy contínuo: alterações enviadas para a branch `main` são publicadas
automaticamente pela Vercel.
