const DOM = {
  headerMenu: document.querySelector(".header__menu"),
  headerSubtitle: document.querySelector(".header__subtitle"),

  chapterGrid: document.querySelector(".app__view--chapters"),
  levelGrid: document.querySelector(".app__view--levels"),
  quizPanel: document.querySelector(".app__view--quiz")
};

function scrollToLastUnlockedLevel() {
  const unlocked = [...DOM.levelGrid.querySelectorAll(".group-btn:not(:disabled)")];
  const last = unlocked[unlocked.length - 1];
  if (!last) return;
  DOM.levelGrid.scrollTop = Math.max(0, last.offsetTop - 300);
}

const Router = {
  current: "chapters",

  pages: {
    chapters: DOM.chapterGrid,
    levels: DOM.levelGrid,
    quiz: DOM.quizPanel
  },

  async go(page, push = true) {

    if (page === this.current) return;

    const oldPage = this.pages[this.current];
    const newPage = this.pages[page];

    // leave
    oldPage.classList.add("page-leave");

    await new Promise(resolve => {
      oldPage.addEventListener("animationend", resolve, {
        once: true
      });
    });

    oldPage.classList.remove("page-leave");
    oldPage.hidden = true;

    // enter
    newPage.hidden = false;
    newPage.classList.add("page-enter");
    
    // scroll ke level terakhir
    scrollToLastUnlockedLevel();
    
    await new Promise(resolve => {
      newPage.addEventListener("animationend", resolve, {
        once: true
      });
    });

    newPage.classList.remove("page-enter");

    this.current = page;

    if (push) {
      history.pushState(
        { page }, "", "#" + page
      );
    }
  }
};

const STORAGE_KEY = "quiz_progress";

// const chapters = {};

// for (let i = 1; i <= 50; i++) {
//   chapters[`chapter-${String(i).padStart(3, "0")}`] = {
//     unlockedLevel: 999,
//     completed: true,
//   };
// }

// localStorage.setItem(
//   STORAGE_KEY,
//   JSON.stringify({ chapters })
// );

// localStorage.setItem(
//   STORAGE_KEY, JSON.stringify({
//     chapters: {
//       "chapter-001": { unlockedLevel: 120, completed: false },
//       "chapter-002": { unlockedLevel: 1, completed: false }
//     }
//   })
// );


// localStorage.clear();

/* ---------------- STATE ---------------- */
const state = {
  chapters: [],
  levels: [],
  chapterId: null,
  chapterWords: {},
  progress: loadProgress(),
  quizTimer: null,
  currentQuiz: null
};

// console.log(state.progress);

/* ---------------- STORAGE (FIXED) ---------------- */

// safe parse biar gak crash kalau corrupt
function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// default structure
function defaultProgress() {
  return { chapters: {} };
}

// LOAD + MERGE (FIX utama reset)
function loadProgress() {
  const raw = safeParse(localStorage.getItem(STORAGE_KEY));
  const base = raw && typeof raw === "object" ? raw : defaultProgress();

  // pastikan chapters selalu object
  if (!base.chapters || typeof base.chapters !== "object") {
    base.chapters = {};
  }

  return base;
}

// SAVE (no change logic, tapi dipastikan clean write)
function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

/* ---------------- INIT PROGRESS (FIXED SAFE MERGE) ---------------- */
function ensureProgress(chapters) {
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];

    const existing = state.progress.chapters[c.id];

    if (!existing) {
      // chapter baru
      state.progress.chapters[c.id] = {
        unlockedLevel: 1,
        completed: false,
        index: i
      };
    } else {
      // IMPORTANT: jangan overwrite progress lama
      state.progress.chapters[c.id] = {
        unlockedLevel: typeof existing.unlockedLevel === "number" ? existing.unlockedLevel : 1,
        completed: typeof existing.completed === "boolean" ? existing.completed : false,
        index: i
      };
    }
  }

  saveProgress();
}

/* ---------------- API ---------------- */
const Api = {
  cache: new Map(),

  async getJSON(url) {
    if (this.cache.has(url)) return this.cache.get(url);

    const res = await fetch(url);
    const data = await res.json();

    this.cache.set(url, data);
    return data;
  },

  async loadInitial() {
    const [chapters, levels] = await Promise.all([
      this.getJSON("./json/index.json"),
      this.getJSON("./json/level.json")
    ]);

    return { chapters, levels };
  },

  loadChapter(file) {
    return this.getJSON(`./json/chapter/${file}`);
  }
};

/* ---------------- LEVEL ENGINE ---------------- */
const LevelEngine = {
  generate(words, configs) {
    const total = words.length;

    return configs.map(cfg => ({
      name: cfg.name,
      size: cfg.size,
      step: cfg.step,
      timer: cfg.timer,
      stages: Array.from({ length: total - 1 }, (_, i) => {
        const stage = i + 1;

        const starts =
          stage === 1 ? [1, 4, 7] : [stage, stage + 6, stage + 3];

        return {
          stage,
          groups: starts.map(start => {
            const group = [];
            let n = ((start - 1) % total) + 1;

            for (let i = 0; i < cfg.size; i++) {
              group.push(n);
              n = ((n + cfg.step - 1) % total) + 1;
            }

            return group;
          })
        };
      })
    }));
  }
};


function shuffle(arr) {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

/* ---------------- QUIZ ---------------- */
const Quiz = {
  start(group, level, globalIndex) {
      
    state.currentQuiz = {
      group,
      level,
      globalIndex
    };
    
    clearInterval(state.quizTimer);
    state.quizTimer = null;
    
    setHeader(`${level.name} - ${globalIndex}`);
    
    const words = group.map(i =>
      state.chapterWords[state.chapterId][i - 1]
    );

    const questions = [
      ...shuffle(words.map(v => ({q: v.kana, a: v.idn, mode: "kana-idn"}))),
      ...shuffle(words.map(v => ({ q: v.idn, a: v.kana, mode: "idn-kana"})))
    ];

    let current = 0;
    let score = 0;
    
    let timeLeft = level.timer;
    
    const startTimer = () => {
      clearInterval(state.quizTimer);
    
      state.quizTimer = setInterval(() => {
        timeLeft--;
    
        const timerEl = DOM.quizPanel.querySelector(".quiz-timer");
    
        if (timerEl) {
          timerEl.textContent = `${timeLeft}s`;
        }
    
        if (timeLeft <= 0) {
          clearInterval(state.quizTimer);
          state.quizTimer = null;
    
          DOM.quizPanel.removeEventListener(
            "click",
            handler
          );
    
          finish();
        }
      }, 1000);
    };
    
    const render = () => {
      const q = questions[current];
      const pool = q.mode === "kana-idn" ? words.map(v => v.idn) : words.map(v => v.kana);
      const options = shuffle([q.a, ...pool.filter(v => v !== q.a)]);
      const questionFont = q.mode === "kana-idn" ? "font-jp" : "font-id";
      const optionFont = q.mode === "kana-idn" ? "font-id" : "font-jp";
      
      DOM.quizPanel.innerHTML = `
        <div class="quiz-panel__controls">
          <div class="quiz-panel__head">
            <span class="quiz-timer" data-level="${level.name}">${timeLeft}s</span>
          </div>
          <div class="quiz-panel__body">
            <div class="quiz-panel__question">
              <h1 class="${questionFont}">${q.q}</h1>
            </div>
            <div class="quiz-panel__answer">
                ${options.map(o =>
                  `<button class="opt u-button ${optionFont}" data-a="${o}">${o}</button>`
                ).join("")}
            </div>
          </div>
        </div>
      `;
      
    };

    const finish = () => {
      clearInterval(state.quizTimer);
      state.quizTimer = null;
      
      const chapter = state.progress.chapters[state.chapterId];
      const perfect = score === questions.length;
      const timeout = timeLeft <= 0;
      const totalLevels = UI.getTotalLevels();
      const hasNextLevel = globalIndex < totalLevels;
      
      DOM.quizPanel.innerHTML = `
        <div class="quiz-panel__result">
          <div class="quiz-panel__result-controls">
            <h2>${timeout ? "Waktu Habis" : "Selesai"}</h2>
            <p>Berhasil menjawab ${score} dari ${questions.length} pertanyaan!</p>
            <div class="quiz-panel__result-detail">
              <button type="button" class="quiz-panel__result-btn u-button">Kembali</button>
              <button type="button" class="quiz-panel__again-btn u-button">Ulang</button>
              ${ perfect && hasNextLevel ? `<button type="button" class="quiz-panel__next-btn u-button">Lanjut</button>` : "" }
            </div>
          </div>
        </div>
      `;

      if (perfect) {
        const prevUnlocked = chapter.unlockedLevel;

        chapter.unlockedLevel = Math.max(
          prevUnlocked,
          globalIndex + 1
        );

        const totalLevels = UI.getTotalLevels();

        if (chapter.unlockedLevel > totalLevels) {
          chapter.completed = true;

          const next = UI.getNextChapter(state.chapterId);
          if (next) {
            const nextProg = state.progress.chapters[next.id];
          
            if (!nextProg) {
              state.progress.chapters[next.id] = {
                unlockedLevel: 1,
                completed: false,
                index: next.index
              };
            }
          }
        }
        

        saveProgress();
      }
      UI.renderChapters();
      UI.renderLevels();
      
    };
    
    const handler = (e) => {
      const btn = e.target.closest(".opt");
      if (!btn) return;

      if (btn.dataset.a === questions[current].a) score++;

      current++;

      if (current < questions.length) render();
      else {
        DOM.quizPanel.removeEventListener("click", handler);
        finish();
      }
    };

    DOM.quizPanel.removeEventListener("click", handler);
    DOM.quizPanel.addEventListener("click", handler);

    render();
    startTimer();
  }
};

/* ---------------- UI ---------------- */
const UI = {
  getCurrentWords() {
    return state.chapterWords[state.chapterId];
  },

  // getTotalLevels() {
  //   const words = this.getCurrentWords();
  //   return words.length * state.levels.length;
  // },
getTotalLevels() {
  const words = this.getCurrentWords();

  const generated = LevelEngine.generate(
    words,
    state.levels
  );

  return generated.reduce((total, level) => {
    return (
      total +
      level.stages.reduce(
        (s, stage) => s + stage.groups.length,
        0
      )
    );
  }, 0);
},
  
  getNextChapter(id) {
    const idx = state.chapters.findIndex(c => c.id === id);
    return state.chapters[idx + 1] || null;
  },

  renderChapters() {
    DOM.chapterGrid.innerHTML = state.chapters.map((c, i) => {
      const prog = state.progress.chapters[c.id];
      const prev = state.chapters[i - 1];
      const locked = i > 0 && !state.progress.chapters[prev.id]?.completed;

      return `
        <button class="u-button" data-id="${c.id}" data-file="${c.file}" data-index="${i}" ${locked ? "disabled" : ""}>
          ${c.title} ${prog?.completed ? "✓" : ""}
        </button>
      `;
    }).join("");
  },

  renderLevels() {
    const words = this.getCurrentWords();
    const levels = LevelEngine.generate(words, state.levels);
    const chapter = state.progress.chapters[state.chapterId];

    let global = 1;

    DOM.levelGrid.innerHTML = levels.map(level =>
      level.stages.flatMap(s => s.groups).map(group => {
        const unlocked = global <= chapter.unlockedLevel;

        const html = `
          <button
            class="group-btn group-${level.name.toLowerCase()} u-button"
            data-group='${JSON.stringify(group)}'
            data-level="${level.name}"
            data-global="${global}"
            ${unlocked ? "" : "disabled"}
          >
            ${level.name} ${global}
          </button>
        `;

        global++;
        return html;
      }).join("")
    ).join("");
  }
};


/* ---------------- EVENTS ---------------- */
function bindEvents() {
  DOM.chapterGrid.addEventListener("click", async (e) => {
    
    const btn = e.target.closest("[data-file]");
    if (!btn || btn.disabled) return;

    const chapter = state.chapters[btn.dataset.index];
    state.chapterId = chapter.id;
    
    if (!state.chapterWords[chapter.id]) {
      state.chapterWords[chapter.id] = await Api.loadChapter(chapter.file);
    }
    
    setHeader(chapter.title);
    UI.renderLevels();
    await Router.go("levels");

    // window.scrollTo(0, 0);
  });

  DOM.levelGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (!btn || btn.disabled) return;

    const group = JSON.parse(btn.dataset.group);
    const level = state.levels.find(v => v.name === btn.dataset.level);
    const globalIndex = Number(btn.dataset.global);

    Quiz.start(group, level, globalIndex);
    Router.go("quiz");
  });
  
  DOM.quizPanel.addEventListener("click", e => {
  
    // kembali
    if (e.target.closest(".quiz-panel__result-btn")) {
      history.back();
      return;
    }
  
    // ulang level yang sama
    if (e.target.closest(".quiz-panel__again-btn")) {
      const quiz = state.currentQuiz;
      if (!quiz) return;
      Quiz.start(quiz.group, quiz.level, quiz.globalIndex);
      return;
    }
  
    // lanjut level berikutnya
    if (e.target.closest(".quiz-panel__next-btn")) {
      const nextBtn = DOM.levelGrid.querySelector(`[data-global="${state.currentQuiz.globalIndex + 1}"]:not(:disabled)`);
      if (!nextBtn) {
        history.back(); // level terakhir
        return;
      }
      const group = JSON.parse(nextBtn.dataset.group);
      const level = state.levels.find(v => v.name === nextBtn.dataset.level);
      Quiz.start(group, level, Number(nextBtn.dataset.global));
    }
  });
}

/* ---------------- INIT ---------------- */
async function init() {
  const { chapters, levels } = await Api.loadInitial();
  state.chapters = chapters;
  state.levels = levels;

  ensureProgress(chapters);
  
  // DEBUG jumlah level
  // let totalAllChapters = 0;

  // for (const chapter of chapters) {
  //   const words = await Api.loadChapter(chapter.file);

  //   const totalLevels =
  //     (words.length - 1) * 3 * levels.length;

  //   console.log(
  //     `${chapter.title}: ${totalLevels} level`
  //   );

  //   totalAllChapters += totalLevels;
  // }

  // console.log(
  //   `TOTAL SEMUA CHAPTER: ${totalAllChapters} level`
  // );
  
  state.chapterId = chapters[0].id;
  state.chapterWords[chapters[0].id] =
    await Api.loadChapter(chapters[0].file);

  setHeader("");
  
  UI.renderChapters();
  UI.renderLevels();
  bindEvents();
  
  // console.log(document.body.innerHTML);
  
  history.replaceState(
    { page: "chapters" }, "", "#chapters"
  );
  
  Router.go("chapters", false);
}

init();


async function setHeader(text = "") {
  const current = DOM.headerMenu.hidden ? DOM.headerSubtitle : DOM.headerMenu;
  current.classList.add("header-leave");

  await new Promise(resolve => {
    current.addEventListener(
      "animationend",
      resolve,
      { once: true }
    );
  });

  current.classList.remove("header-leave");

  const showSubtitle = !!text;

  DOM.headerMenu.hidden = showSubtitle;
  DOM.headerSubtitle.hidden = !showSubtitle;

  if (showSubtitle) {
    DOM.headerSubtitle.textContent = text;
    DOM.headerSubtitle.classList.add("header-enter");

    DOM.headerSubtitle.addEventListener("animationend", () => {
      DOM.headerSubtitle.classList.remove("header-enter");
    }, { once: true } );
  } else {
    DOM.headerMenu.classList.add("header-enter");

    DOM.headerMenu.addEventListener("animationend", () => {
        DOM.headerMenu.classList.remove("header-enter");
    }, { once: true } );
  }
}

window.addEventListener("popstate", e => {
  clearInterval(state.quizTimer);
  state.quizTimer = null;

  const page = e.state?.page || "chapters";

  switch (page) {
    case "chapters":
      setHeader("");
      break;

    case "levels": {
      const chapter = state.chapters.find(
        c => c.id === state.chapterId
      );

      setHeader(chapter?.title || "");
      break;
    }
  }

  Router.go(page, false);
});



// const clickSound = new Audio("assets/audios/click.mp3");
// document.addEventListener("click", (e) => {
//   if (!e.target.closest("button, .u-button")) return;
//   const sound = clickSound.cloneNode();
//   sound.play().catch(() => {});
// });


const audioCtx = new AudioContext();

async function loadClick() {
  const res = await fetch("./assets/audios/click.mp3");
  const buf = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(buf);
}

let clickBuffer;

loadClick().then(buffer => {
  clickBuffer = buffer;
});

function playClick() {
  if (!clickBuffer) return;

  const source = audioCtx.createBufferSource();
  source.buffer = clickBuffer;
  source.connect(audioCtx.destination);
  source.start();
}

document.addEventListener("click", e => {
  if (!e.target.closest("button")) return;

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  playClick();
});