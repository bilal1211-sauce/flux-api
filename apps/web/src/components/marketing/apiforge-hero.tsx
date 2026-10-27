import Link from "next/link";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  CheckCheck,
  Code2,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  Waypoints,
} from "lucide-react";
import styles from "./apiforge-hero.module.css";

// Original APIForge design; not the licensed React Bits Pro Hero 13 block.
export function ApiForgeHero() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="FluxAPI home">
          <span>
            <Waypoints size={20} />
          </span>
          FluxAPI
        </Link>
        <nav aria-label="Main navigation">
          <a href="#workflow" className={styles.navLink}>
            How it works
          </a>
          <Link href="/dashboard" className={styles.navButton}>
            Open workspace <ArrowRight size={15} />
          </Link>
        </nav>
      </header>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.floatingIcons} aria-hidden="true">
          <span className={`${styles.float} ${styles.braces}`}>
            <Braces size={29} />
          </span>
          <span className={`${styles.float} ${styles.branch}`}>
            <GitBranch size={27} />
          </span>
          <span className={`${styles.float} ${styles.lock}`}>
            <LockKeyhole size={25} />
          </span>
          <span className={`${styles.float} ${styles.activity}`}>
            <Activity size={28} />
          </span>
          <span className={`${styles.float} ${styles.code}`}>
            <Code2 size={27} />
          </span>
          <span className={`${styles.float} ${styles.check}`}>
            <CheckCheck size={27} />
          </span>
        </div>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>
            <span /> YOUR EVERYDAY API WORKSPACE
          </p>
          <h1 id="hero-title">
            Make the request.
            <br />
            <span>Know the response.</span>
          </h1>
          <p className={styles.description}>
            Send requests, check what comes back, and keep an eye on the
            endpoints your team depends on. All in one workspace.
          </p>
          <div className={styles.actions}>
            <Link href="/dashboard" className={styles.primary}>
              Open your workspace <ArrowRight size={17} />
            </Link>
            <a href="#workflow" className={styles.secondary}>
              See how it works <ArrowDown size={15} />
            </a>
          </div>
          <p className={styles.note}>
            <LockKeyhole size={13} /> Private workspaces. Encrypted environment
            secrets.
          </p>
        </div>
        <div className={styles.horizon}>
          <div className={styles.glow} aria-hidden="true" />
          <div className={styles.example}>
            <div className={styles.exampleLabel}>
              <span>EXAMPLE REQUEST</span>
              <Braces size={14} />
            </div>
            <div className={styles.request}>
              <span className={styles.method}>GET</span>
              <code>/posts/1</code>
              <span className={styles.status}>
                <Check size={13} /> 200 OK
              </span>
            </div>
            <div className={styles.result}>
              <span className={styles.resultDot} />
              <span>Status assertion passed</span>
              <span>JSON response</span>
            </div>
          </div>
        </div>
      </section>
      <section
        id="workflow"
        className={styles.workflow}
        aria-labelledby="workflow-title"
      >
        <div className={styles.sectionHeading}>
          <p>FROM REQUEST TO ROUTINE</p>
          <h2 id="workflow-title">A clearer way to work with APIs.</h2>
        </div>
        <div className={styles.steps}>
          <article>
            <div className={styles.stepTop}>
              <FolderOpen size={21} />
              <span>01 / ORGANIZE</span>
            </div>
            <h3>Keep the useful requests.</h3>
            <p>
              Group endpoints into collections. Switch environments without
              rebuilding the request.
            </p>
          </article>
          <article>
            <div className={styles.stepTop}>
              <CheckCheck size={21} />
              <span>02 / CHECK</span>
            </div>
            <h3>Look beyond the status code.</h3>
            <p>
              Inspect bodies and headers. Add assertions for the response you
              actually expect.
            </p>
          </article>
          <article>
            <div className={styles.stepTop}>
              <Activity size={21} />
              <span>03 / MONITOR</span>
            </div>
            <h3>Check again, on a schedule.</h3>
            <p>
              Run saved requests automatically. Review failures, recoveries and
              run history with your team.
            </p>
          </article>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>
          FluxAPI <span>/</span> Built for day-to-day API work.
        </span>
        <Link href="/dashboard">
          Go to workspace <ArrowRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
