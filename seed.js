'use strict';
/* 初始数据：来自用户之前的手写记录。
   d = 难度：'easy' 简单 / 'medium' 适中 / 'hard' 困难 / null 未标注
   reps 未写明的统一按 10 填，之后可在 App 里改。 */
const SEED = {
  tabs: [
    { name: '背', exercises: [
      { name: '反手高位下拉',         weight: 52.5, reps: 10, d: 'medium' },
      { name: '坐姿绳索划船',         weight: 52.8, reps: 8,  d: null },
      { name: '中距离对握高位下拉',   weight: 56,   reps: 10, d: 'medium' },
      { name: '中距离对握开肘划船',   weight: 52.8, reps: 6,  d: 'medium' },
      { name: '直臂下压',             weight: 12.5, reps: 10, d: 'medium' }
    ]},
    { name: '肩', exercises: [
      { name: '热身 · 反手',          weight: 7.5,  reps: 10, d: null },
      { name: '热身 · 正手',          weight: 5,    reps: 10, d: null },
      { name: '哑铃侧平举',           weight: 10,   reps: 10, d: 'hard' },
      { name: '绳索面拉',             weight: 12.5, reps: 10, d: null },
      { name: '杠铃前平举',           weight: 20,   reps: 10, d: 'hard' },
      { name: '器械推肩',             weight: 40,   reps: 10, d: null },
      { name: '侧平举器械',           weight: 20,   reps: 10, d: 'medium' },
      { name: '绳索面拉（重）',       weight: 20,   reps: 10, d: null }
    ]},
    { name: '手臂', exercises: [
      { name: '曲杆三头',             weight: 24,   reps: 10, d: 'medium' },
      { name: '绳索臂屈伸',           weight: 15,   reps: 10, d: 'hard' },
      { name: '直杆二头',             weight: 37.5, reps: 10, d: 'easy' },
      { name: '绳索弯举',             weight: 30,   reps: 10, d: null },
      { name: '牧师凳',               weight: 20,   reps: 10, d: 'easy' }
    ]},
    { name: '胸', exercises: [
      { name: '杠铃卧推',             weight: 75,   reps: 10, d: null },
      { name: '器械推胸',             weight: 57,   reps: 6,  d: 'hard' },
      { name: '哑铃卧推',             weight: 28,   reps: 10, d: 'easy' },
      { name: '上斜哑铃',             weight: 28,   reps: 6,  d: null }
    ]},
    { name: '引体', mode: 'sets', exercises: [
      { name: '引体',                 sets: 8, weight: 0, reps: 10, d: null }
    ]}
  ]
};
