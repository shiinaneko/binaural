import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

// StrictMode は使わない: 副作用の二重実行が AudioContext と衝突するため
createRoot(container).render(<App />);
