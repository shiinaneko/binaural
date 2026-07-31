import { createRoot } from 'react-dom/client';
import { setupServiceWorkerAutoReload } from './pwa/update';
import { App } from './ui/App';
import './styles.css';

// 新しい版が入ったら読み込み直す（古いコードで動き続けるのを防ぐ）
setupServiceWorkerAutoReload();

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

// StrictMode は使わない: 副作用の二重実行が AudioContext と衝突するため
createRoot(container).render(<App />);
