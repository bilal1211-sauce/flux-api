# Backend aur frontend free mein live karna

16 October 2026 ko provider ki official documentation check ki gayi. Is repository ka full setup Next.js server, Laravel API, executor, MySQL, Redis, worker aur scheduler chalata hai. Isliye ek free Linux VM par Compose deploy karna is architecture ka practical option hai.

## Recommended route: Oracle Always Free VM

[Oracle ki current documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) mein A1 allowance **2 OCPUs / 12 GB RAM** aur combined boot/block storage **200 GB** hai. Home-region capacity available honi chahiye; idle instances reclaim ho sakti hain. Account verification aur dashboard par Always Free eligibility check karni hogi. Free allowance ke andar resource select karein; paid resources ya trial credit ko permanent free hosting na samjhein.

1. Oracle account mein home region select karein. Ubuntu ARM A1 VM banayein, Always Free allocation ke andar. Ek 50 GB boot disk is demo ke liye kaafi hai. Account/region mein shape unavailable ho to deployment wait karega.
2. Public IP par DNS hostname point karein. Apna existing domain use kar sakte hain, ya [sslip.io](https://sslip.io/) ka IP-based hostname. Misal: `YOUR_PUBLIC_IP.sslip.io`. Free shared DNS ki availability aur certificate rate limits provider par depend karti hain.
3. VM par [official Docker Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) se Docker Engine aur Compose plugin install karein. Cloud network aur host firewall mein 80/443 allow karein; SSH ko apne IP tak restrict karein.
4. Repository VM par copy/clone karein. `.tools`, `.runtime`, `.backups`, local `.env` aur demo credentials upload na karein. Dependencies container build mein install hoti hain.
5. Repository root par:

```bash
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
# APP_KEY ke liye: printf 'base64:'; openssl rand -base64 32
# Har database/Redis/executor secret ke liye alag: openssl rand -hex 32
nano infrastructure/.env
```

`WEB_HOST=YOUR_PUBLIC_IP.sslip.io`, `WEB_ORIGIN=https://YOUR_PUBLIC_IP.sslip.io` aur `ACME_EMAIL` set karein. Strong unique secrets aur real SMTP settings bharein. SMTP provider ka free account/verified sender alag connect hoga. Verification, invitations aur recovery SMTP ke baghair inbox mein deliver nahi honge.

6. Build, migrations aur services start karein:

```bash
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml build
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d mysql redis
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml run --rm api php artisan migrate --force
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml -f infrastructure/proxy.compose.yaml up -d
sudo bash infrastructure/executor-firewall.sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec api php artisan apiforge:doctor
```

Caddy DNS sahi hone aur ports available hone par HTTPS certificate automatically request karta hai. Frontend hi public entry point hai; browser gateway Laravel tak private network se pahunchta hai. Backend, database aur executor ke public ports kholne ki zarurat nahi.

7. HTTPS URL par apna account banayein, verification email open karein, ek request run karein aur monitor check karein. Server console se apne account ko admin banayein:

```bash
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec api php artisan apiforge:admin YOUR_EMAIL
bash infrastructure/backup.sh
```

Backups ko VM ke bahar protected storage mein copy karein. App key ki separate encrypted copy rakhein. Firewall rules container recreation/host reboot ke baad reapply karein. Detailed operations aur restore steps [DEPLOYMENT.md](DEPLOYMENT.md) mein hain.

## Doosre free plans ka tradeoff

[Render Free](https://render.com/docs/free) par services sleep karti hain, persistent disks free web services ko available nahi, aur free Postgres 30 din mein expire hota hai. Is project ko worker, persistent MySQL aur scheduler bhi chahiye; isliye use bina architecture/hosting changes ke complete permanent free deployment samajhna theek nahi.

Cloudflare Pages par is Next.js gateway ko static export karke upload karna kaafi nahi: cookie handling aur authenticated API routes server runtime maangte hain. VM route frontend aur backend ko ek origin par rakhta hai.

## Abhi actual status

Local app aur local database restore verify kiye gaye hain. Cloud VM/account, domain/DNS aur real SMTP credentials is workspace mein available nahi hain. Public deployment, Docker runtime aur production firewall is Windows machine par execute nahi kiye gaye; container CI smoke workflow aur deployment files review/run karne ke liye included hain. Is document ka hona live URL banne ka claim nahi hai.
