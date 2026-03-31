/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  deleteDoc,
  doc, 
  serverTimestamp, 
  onSnapshot,
  increment,
  writeBatch
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Scan, 
  Plus, 
  Minus, 
  CheckCircle2, 
  ArrowLeft, 
  History, 
  Package, 
  Users, 
  LogOut, 
  Settings,
  AlertCircle,
  ChevronRight,
  RotateCcw,
  Trash2,
  Edit2,
  Save,
  X,
  FileUp,
  Download,
  Smartphone,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from './lib/utils';

// Types
interface Equipment {
  id: string;
  name: string;
  totalQuantity: number;
  availableQuantity: number;
  category: string;
  location?: string;
}

interface ClassInfo {
  id: string;
  className: string;
  barcode: string;
}

interface Loan {
  id: string;
  classId: string;
  className: string;
  borrowerName: string;
  equipmentId: string;
  equipmentName: string;
  quantity: number;
  status: 'borrowed' | 'returned';
  borrowedAt: any;
  returnedAt?: any;
  condition?: string;
}

type View = 'home' | 'borrow' | 'return' | 'admin' | 'manage_equipment' | 'manage_classes';
type BorrowStep = 'class' | 'equipment' | 'borrower' | 'success';
type ReturnStep = 'class' | 'select' | 'success';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [user, setUser] = useState<User | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  // Borrow State
  const [borrowStep, setBorrowStep] = useState<BorrowStep>('class');
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);
  const [selectedItems, setSelectedItems] = useState<{ [id: string]: number }>({});
  const [borrowerName, setBorrowerName] = useState('');

  // Return State
  const [returnStep, setReturnStep] = useState<ReturnStep>('class');
  const [activeLoans, setActiveLoans] = useState<Loan[]>([]);
  const [returningItems, setReturningItems] = useState<{ [id: string]: { quantity: number, condition: string } }>({});

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Management State
  const [isEditing, setIsEditing] = useState<string | null>(null); // ID of item being edited
  const [newEquip, setNewEquip] = useState({ name: '', totalQuantity: 0, category: '球類', location: '' });
  const [newClass, setNewClass] = useState({ className: '', barcode: '' });
  const [confirmModal, setConfirmModal] = useState<{ 
    id?: string, 
    type: 'equipment' | 'class' | 'bulk_equipment' | 'bulk_class', 
    title: string,
    data?: any[]
  } | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    const unsubEquip = onSnapshot(collection(db, 'equipment'), (snapshot) => {
      setEquipment(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Equipment)));
    });

    const unsubClasses = onSnapshot(collection(db, 'classes'), (snapshot) => {
      setClasses(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ClassInfo)));
    });

    const unsubLoans = onSnapshot(collection(db, 'loans'), (snapshot) => {
      setLoans(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Loan)));
    });

    return () => {
      unsubAuth();
      unsubEquip();
      unsubClasses();
      unsubLoans();
    };
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const startScanner = (onScan: (decodedText: string) => void) => {
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );
      scanner.render(onScan, (err) => {
        // console.warn(err);
      });
      scannerRef.current = scanner;
    }, 100);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(err => console.error("Failed to clear scanner", err));
      scannerRef.current = null;
    }
  };

  // Borrow Logic
  const handleClassScan = (barcode: string) => {
    const foundClass = classes.find(c => c.barcode === barcode || c.className === barcode);
    if (foundClass) {
      setSelectedClass(foundClass);
      setBorrowStep('equipment');
      stopScanner();
    } else {
      setNotification({ message: '找不到該班級，請確認編號或條碼', type: 'error' });
    }
  };

  const handleBorrowSubmit = async () => {
    if (!selectedClass || Object.keys(selectedItems).length === 0 || !borrowerName) return;

    try {
      const batch = writeBatch(db);
      
      const itemsToBorrow = Object.entries(selectedItems) as [string, number][];
      for (const [id, qty] of itemsToBorrow) {
        if (qty <= 0) continue;
        
        const equip = equipment.find(e => e.id === id);
        if (!equip) continue;

        const loanData = {
          classId: selectedClass.id,
          className: selectedClass.className,
          borrowerName,
          equipmentId: id,
          equipmentName: equip.name,
          quantity: qty,
          status: 'borrowed',
          borrowedAt: serverTimestamp(),
        };

        const loanRef = doc(collection(db, 'loans'));
        batch.set(loanRef, loanData);

        const equipRef = doc(db, 'equipment', id);
        batch.update(equipRef, {
          availableQuantity: increment(-qty)
        });
      }

      await batch.commit();
      setBorrowStep('success');
      setNotification({ message: '借用成功！', type: 'success' });
    } catch (error) {
      console.error('Borrow failed:', error);
      setNotification({ message: '借用失敗，請稍後再試', type: 'error' });
    }
  };

  // Return Logic
  const handleReturnClassScan = async (barcode: string) => {
    const foundClass = classes.find(c => c.barcode === barcode || c.className === barcode);
    if (foundClass) {
      setSelectedClass(foundClass);
      const q = query(
        collection(db, 'loans'), 
        where('classId', '==', foundClass.id), 
        where('status', '==', 'borrowed')
      );
      const snapshot = await getDocs(q);
      const loans = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Loan));
      setActiveLoans(loans);
      setReturnStep('select');
      stopScanner();
    } else {
      setNotification({ message: '找不到該班級', type: 'error' });
    }
  };

  const resetReturn = () => {
    setSelectedClass(null);
    setReturningItems({});
    setReturnStep('class');
  };

  const handleReturnSubmit = async () => {
    try {
      const batch = writeBatch(db);
      
      const itemsToReturn = Object.entries(returningItems) as [string, { quantity: number, condition: string }][];
      for (const [loanId, data] of itemsToReturn) {
        if (data.quantity <= 0) continue;
        
        const loan = activeLoans.find(l => l.id === loanId);
        if (!loan) continue;

        if (data.quantity === loan.quantity) {
          // Full return
          const loanRef = doc(db, 'loans', loanId);
          batch.update(loanRef, {
            status: 'returned',
            returnedAt: serverTimestamp(),
            condition: data.condition
          });
        } else {
          // Partial return
          // 1. Update original loan with remaining quantity
          const loanRef = doc(db, 'loans', loanId);
          batch.update(loanRef, {
            quantity: loan.quantity - data.quantity
          });

          // 2. Create a new record for the returned portion
          const returnedLoanRef = doc(collection(db, 'loans'));
          batch.set(returnedLoanRef, {
            ...loan,
            id: returnedLoanRef.id,
            quantity: data.quantity,
            status: 'returned',
            returnedAt: serverTimestamp(),
            condition: data.condition
          });
        }

        const equipRef = doc(db, 'equipment', loan.equipmentId);
        batch.update(equipRef, {
          availableQuantity: increment(data.quantity)
        });
      }

      await batch.commit();
      setReturnStep('success');
      setNotification({ message: '歸還成功！', type: 'success' });
    } catch (error) {
      console.error('Return failed:', error);
      setNotification({ message: '歸還失敗', type: 'error' });
    }
  };

  const resetBorrow = () => {
    setBorrowStep('class');
    setSelectedClass(null);
    setSelectedItems({});
    setBorrowerName('');
    stopScanner();
  };

  // Equipment Management Logic
  const handleAddEquipment = async () => {
    if (!newEquip.name || newEquip.totalQuantity <= 0) return;
    try {
      await addDoc(collection(db, 'equipment'), {
        ...newEquip,
        availableQuantity: newEquip.totalQuantity
      });
      setNewEquip({ name: '', totalQuantity: 0, category: '球類', location: '' });
    } catch (error) {
      console.error('Add equipment failed:', error);
    }
  };

  const handleUpdateEquipment = async (id: string, updates: Partial<Equipment>) => {
    try {
      const ref = doc(db, 'equipment', id);
      await updateDoc(ref, updates);
      setIsEditing(null);
    } catch (error) {
      console.error('Update equipment failed:', error);
    }
  };

  const handleDeleteEquipment = (id: string) => {
    setConfirmModal({
      id,
      type: 'equipment',
      title: '確定要刪除此器材嗎？這將會移除所有相關紀錄。'
    });
  };

  const executeDelete = async () => {
    if (!confirmModal) return;
    const { id, type, data } = confirmModal;
    try {
      if (type === 'bulk_equipment' || type === 'bulk_class') {
        const collectionName = type === 'bulk_equipment' ? 'equipment' : 'classes';
        const snapshot = await getDocs(collection(db, collectionName));
        const batch = writeBatch(db);
        
        // Delete all existing
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        
        // Add new from data
        if (data) {
          data.forEach(row => {
            const ref = doc(collection(db, collectionName));
            if (type === 'bulk_equipment') {
              const totalQty = parseInt(row.totalQuantity || row['總數量']) || 0;
              const name = row.name || row['器材名稱'] || row['名稱'] || '未命名器材';
              const category = row.category || row['分類'] || '其他';
              const location = row.location || row['存放位置'] || '';
              batch.set(ref, { name, totalQuantity: totalQty, availableQuantity: totalQty, category, location });
            } else {
              const className = row.className || row['班級名稱'] || row['班級'] || '未命名班級';
              const barcode = row.barcode || row['條碼編號'] || row['條碼'] || '';
              batch.set(ref, { className, barcode });
            }
          });
        }
        
        await batch.commit();
        setNotification({ message: '匯入並覆蓋成功', type: 'success' });
      } else {
        if (!id) return;
        await deleteDoc(doc(db, type === 'equipment' ? 'equipment' : 'classes', id));
        setNotification({ message: '刪除成功', type: 'success' });
      }
    } catch (error) {
      console.error('Operation failed:', error);
      setNotification({ message: '操作失敗', type: 'error' });
    } finally {
      setConfirmModal(null);
    }
  };

  // Class Management Logic
  const handleAddClass = async () => {
    if (!newClass.className || !newClass.barcode) return;
    try {
      await addDoc(collection(db, 'classes'), newClass);
      setNewClass({ className: '', barcode: '' });
    } catch (error) {
      console.error('Add class failed:', error);
    }
  };

  const handleDeleteClass = (id: string) => {
    setConfirmModal({
      id,
      type: 'class',
      title: '確定要刪除此班級嗎？'
    });
  };

  // CSV Import/Export Logic
  const parseCSV = (file: File, onComplete: (data: any[]) => void) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const uint8 = new Uint8Array(buffer);
      
      // Check for UTF-8 BOM (EF BB BF)
      const hasBOM = uint8[0] === 0xEF && uint8[1] === 0xBB && uint8[2] === 0xBF;
      
      let encoding = "UTF-8";
      if (!hasBOM) {
        // Use TextDecoder to check if it's valid UTF-8
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          decoder.decode(uint8);
          encoding = "UTF-8";
        } catch (err) {
          // If decoding fails, it's likely Big5 (common for Excel CSV in TW/HK)
          encoding = "Big5";
        }
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: encoding,
        complete: (results) => {
          onComplete(results.data);
        }
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const handleEquipmentCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parseCSV(file, (data) => {
      if (data.length === 0) {
        setNotification({ message: 'CSV 檔案為空', type: 'error' });
        return;
      }
      setConfirmModal({
        type: 'bulk_equipment',
        title: `確定要匯入這 ${data.length} 筆器材嗎？這將會「刪除並覆蓋」現有的所有器材清單！`,
        data
      });
      e.target.value = ''; // Reset input
    });
  };

  const handleClassCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    parseCSV(file, (data) => {
      if (data.length === 0) {
        setNotification({ message: 'CSV 檔案為空', type: 'error' });
        return;
      }
      setConfirmModal({
        type: 'bulk_class',
        title: `確定要匯入這 ${data.length} 筆班級嗎？這將會「刪除並覆蓋」現有的所有班級資料！`,
        data
      });
      e.target.value = ''; // Reset input
    });
  };

  const downloadTemplate = (type: 'equipment' | 'class') => {
    const data: any[] = type === 'equipment' 
      ? [{ name: '範例器材', totalQuantity: 10, category: '球類', location: '器材室 A1' }]
      : [{ className: '101', barcode: '101' }];
    
    // Add UTF-8 BOM (\uFEFF) so Excel opens it correctly as UTF-8
    const csv = "\uFEFF" + Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${type}_template.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Admin Seed Data
  const seedData = async () => {
    if (!user) return;
    try {
      const batch = writeBatch(db);
      
      const sampleEquip = [
        { name: '大顆籃球', totalQuantity: 20, availableQuantity: 20, category: '球類', location: '體育器材室 A1' },
        { name: '小顆籃球', totalQuantity: 15, availableQuantity: 15, category: '球類', location: '體育器材室 A1' },
        { name: '排球', totalQuantity: 25, availableQuantity: 25, category: '球類', location: '體育器材室 A2' },
        { name: '足球', totalQuantity: 10, availableQuantity: 10, category: '球類', location: '操場器材櫃' },
        { name: '跳繩', totalQuantity: 50, availableQuantity: 50, category: '體適能', location: '體育器材室 B1' },
        { name: '大隊接力棒', totalQuantity: 16, availableQuantity: 16, category: '小型器材', location: '體育器材室 C1' },
      ];

      sampleEquip.forEach(e => {
        const ref = doc(collection(db, 'equipment'));
        batch.set(ref, e);
      });

      const sampleClasses = [
        { className: '101', barcode: '101' },
        { className: '102', barcode: '102' },
        { className: '201', barcode: '201' },
        { className: '202', barcode: '202' },
        { className: '301', barcode: '301' },
      ];

      sampleClasses.forEach(c => {
        const ref = doc(collection(db, 'classes'));
        batch.set(ref, c);
      });

      await batch.commit();
      setNotification({ message: '資料初始化成功！', type: 'success' });
    } catch (error) {
      console.error('Seed failed:', error);
      setNotification({ message: '初始化失敗', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-slate-400">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer" 
            onClick={() => { setView('home'); resetBorrow(); resetReturn(); }}
          >
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Package className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">體育器材管理</h1>
          </div>
          
          <div className="flex items-center gap-2">
            {user ? (
              <button 
                onClick={() => auth.signOut()}
                className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <LogOut size={20} />
              </button>
            ) : (
              <button 
                onClick={handleLogin}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                管理員登入
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-blue-600 rounded-3xl p-8 text-white shadow-xl shadow-blue-200 relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="text-2xl font-bold mb-2">歡迎使用</h2>
                  <p className="text-blue-100 text-sm opacity-90">請選擇您要進行的操作</p>
                </div>
                <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
              </div>

              <div className="grid gap-4">
                <button 
                  onClick={() => { setView('borrow'); setBorrowStep('class'); }}
                  className="group bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-500 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <Plus size={24} />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-lg">器材借用</div>
                      <div className="text-slate-500 text-sm">掃描借用證開始借用</div>
                    </div>
                  </div>
                  <ChevronRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                </button>

                <button 
                  onClick={() => { setView('return'); setReturnStep('class'); }}
                  className="group bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-500 transition-all flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <RotateCcw size={24} />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-lg">器材歸還</div>
                      <div className="text-slate-500 text-sm">歸還已借出的器材</div>
                    </div>
                  </div>
                  <ChevronRight className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                </button>
              </div>

              {user && (
                <div className="pt-8 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-400 uppercase text-xs tracking-widest">管理員功能</h3>
                    <Settings size={16} className="text-slate-400" />
                  </div>
                  <div className="grid gap-3">
                    <button 
                      onClick={() => setView('admin')}
                      className="w-full py-3 px-4 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <History size={18} />
                      查看借還紀錄
                    </button>
                    <button 
                      onClick={() => setView('manage_equipment')}
                      className="w-full py-3 px-4 bg-white border border-slate-200 text-slate-900 rounded-xl font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <Package size={18} />
                      器材清單管理
                    </button>
                    <button 
                      onClick={() => setView('manage_classes')}
                      className="w-full py-3 px-4 bg-white border border-slate-200 text-slate-900 rounded-xl font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <Users size={18} />
                      班級資料管理
                    </button>
                    <button 
                      onClick={seedData}
                      className="w-full py-3 px-4 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                    >
                      <RotateCcw size={18} />
                      初始化範例資料
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'borrow' && (
            <motion.div 
              key="borrow"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => { setView('home'); resetBorrow(); }}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold">器材借用</h2>
              </div>

              {/* Steps Indicator */}
              <div className="flex justify-between px-2">
                {['class', 'equipment', 'borrower', 'success'].map((step, idx) => (
                  <div key={step} className="flex flex-col items-center gap-1">
                    <div className={cn(
                      "w-2 h-2 rounded-full transition-all duration-300",
                      borrowStep === step ? "bg-blue-600 scale-150" : "bg-slate-200"
                    )} />
                  </div>
                ))}
              </div>

              {borrowStep === 'class' && (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Scan size={32} />
                    </div>
                    <h3 className="font-bold text-lg">請登入班級</h3>
                    <p className="text-slate-500 text-sm">掃描借用證條碼或輸入班級編號</p>
                  </div>

                  <div id="reader" className="overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-white" />
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-slate-50 px-2 text-slate-400">或手動輸入</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="班級編號 (如: 101)"
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleClassScan(e.currentTarget.value);
                      }}
                    />
                    <button 
                      onClick={() => startScanner(handleClassScan)}
                      className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-colors"
                    >
                      <Scan size={24} />
                    </button>
                  </div>
                </div>
              )}

              {borrowStep === 'equipment' && (
                <div className="space-y-6">
                  <div className="bg-blue-50 p-4 rounded-2xl flex items-center gap-3">
                    <Users className="text-blue-600" size={20} />
                    <div>
                      <div className="text-xs text-blue-600 font-bold uppercase tracking-wider">借用班級</div>
                      <div className="font-bold">{selectedClass?.className}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest px-1">選擇器材</h3>
                    <div className="grid gap-3">
                      {equipment.map(item => (
                        <div 
                          key={item.id}
                          className={cn(
                            "bg-white p-4 rounded-2xl border transition-all flex items-center justify-between",
                            selectedItems[item.id] > 0 ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200"
                          )}
                        >
                          <div>
                            <div className="font-bold">{item.name}</div>
                            <div className="text-xs text-slate-400">
                              剩餘: {item.availableQuantity} {item.location && `| 存放: ${item.location}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => setSelectedItems(prev => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] || 0) - 1) }))}
                              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50"
                            >
                              <Minus size={16} />
                            </button>
                            <span className="w-6 text-center font-bold">{selectedItems[item.id] || 0}</span>
                            <button 
                              onClick={() => {
                                if ((selectedItems[item.id] || 0) < item.availableQuantity) {
                                  setSelectedItems(prev => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
                                }
                              }}
                              className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white hover:bg-blue-700"
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button 
                    disabled={Object.values(selectedItems).every(v => v === 0)}
                    onClick={() => setBorrowStep('borrower')}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:shadow-none"
                  >
                    下一步
                  </button>
                </div>
              )}

              {borrowStep === 'borrower' && (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Users size={32} />
                    </div>
                    <h3 className="font-bold text-lg">輸入借用人</h3>
                    <p className="text-slate-500 text-sm">請輸入負責借用的學生姓名</p>
                  </div>

                  <input 
                    autoFocus
                    type="text" 
                    placeholder="例如: 王小明"
                    value={borrowerName}
                    onChange={(e) => setBorrowerName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-6 py-4 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />

                  <div className="bg-slate-100 p-4 rounded-2xl space-y-2">
                    <div className="text-xs font-bold text-slate-400 uppercase">借用清單</div>
                    {Object.entries(selectedItems).map(([id, qty]) => {
                      if (qty === 0) return null;
                      const item = equipment.find(e => e.id === id);
                      return (
                        <div key={id} className="flex justify-between text-sm">
                          <span>{item?.name}</span>
                          <span className="font-bold">x {qty}</span>
                        </div>
                      );
                    })}
                  </div>

                  <button 
                    disabled={!borrowerName}
                    onClick={handleBorrowSubmit}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50"
                  >
                    確認借用
                  </button>
                </div>
              )}

              {borrowStep === 'success' && (
                <div className="text-center py-12 space-y-6">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto"
                  >
                    <CheckCircle2 size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold">借用成功！</h3>
                    <p className="text-slate-500">請愛惜器材，並準時歸還。</p>
                  </div>
                  <button 
                    onClick={() => { setView('home'); resetBorrow(); }}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all"
                  >
                    返回首頁
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {view === 'return' && (
            <motion.div 
              key="return"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => { setView('home'); resetReturn(); }}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold">器材歸還</h2>
              </div>

              {returnStep === 'class' && (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Scan size={32} />
                    </div>
                    <h3 className="font-bold text-lg">請登入班級</h3>
                    <p className="text-slate-500 text-sm">掃描借用證條碼或輸入班級編號</p>
                  </div>

                  <div id="reader" className="overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-white" />
                  
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="班級編號 (如: 101)"
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleReturnClassScan(e.currentTarget.value);
                      }}
                    />
                    <button 
                      onClick={() => startScanner(handleReturnClassScan)}
                      className="bg-emerald-600 text-white p-3 rounded-xl hover:bg-emerald-700 transition-colors"
                    >
                      <Scan size={24} />
                    </button>
                  </div>
                </div>
              )}

              {returnStep === 'select' && (
                <div className="space-y-6">
                  <div className="bg-emerald-50 p-4 rounded-2xl flex items-center gap-3">
                    <Users className="text-emerald-600" size={20} />
                    <div>
                      <div className="text-xs text-emerald-600 font-bold uppercase tracking-wider">歸還班級</div>
                      <div className="font-bold">{selectedClass?.className}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest px-1">待歸還器材</h3>
                    {activeLoans.length === 0 ? (
                      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2">
                        <CheckCircle2 className="text-emerald-500 mx-auto" size={32} />
                        <p className="text-slate-500">目前沒有借用中的器材</p>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {activeLoans.map(loan => (
                          <div 
                            key={loan.id}
                            className={cn(
                              "bg-white p-4 rounded-2xl border transition-all space-y-4",
                              returningItems[loan.id]?.quantity > 0 ? "border-emerald-500 ring-1 ring-emerald-500" : "border-slate-200"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-bold">{loan.equipmentName}</div>
                                <div className="text-xs text-slate-400">借用人: {loan.borrowerName} | 借出數量: {loan.quantity}</div>
                              </div>
                              <div className="flex items-center gap-3">
                                {returningItems[loan.id] && (
                                  <div className="flex items-center gap-2 mr-2">
                                    <button 
                                      onClick={() => setReturningItems(prev => ({ 
                                        ...prev, 
                                        [loan.id]: { ...prev[loan.id], quantity: Math.max(1, prev[loan.id].quantity - 1) } 
                                      }))}
                                      className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50"
                                    >
                                      <Minus size={14} />
                                    </button>
                                    <span className="w-4 text-center font-bold text-sm">{returningItems[loan.id].quantity}</span>
                                    <button 
                                      onClick={() => setReturningItems(prev => ({ 
                                        ...prev, 
                                        [loan.id]: { ...prev[loan.id], quantity: Math.min(loan.quantity, prev[loan.id].quantity + 1) } 
                                      }))}
                                      className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white hover:bg-emerald-700"
                                    >
                                      <Plus size={14} />
                                    </button>
                                  </div>
                                )}
                                <button 
                                  onClick={() => {
                                    if (returningItems[loan.id]) {
                                      setReturningItems(prev => {
                                        const next = { ...prev };
                                        delete next[loan.id];
                                        return next;
                                      });
                                    } else {
                                      setReturningItems(prev => ({ ...prev, [loan.id]: { quantity: loan.quantity, condition: '良好' } }));
                                    }
                                  }}
                                  className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                                    returningItems[loan.id] ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
                                  )}
                                >
                                  <CheckCircle2 size={20} />
                                </button>
                              </div>
                            </div>

                            {returningItems[loan.id] && (
                              <div className="pt-3 border-t border-slate-100 flex gap-2">
                                {['良好', '損壞', '遺失'].map(cond => (
                                  <button
                                    key={cond}
                                    onClick={() => setReturningItems(prev => ({ ...prev, [loan.id]: { ...prev[loan.id], condition: cond } }))}
                                    className={cn(
                                      "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                                      returningItems[loan.id].condition === cond 
                                        ? "bg-slate-900 text-white" 
                                        : "bg-slate-100 text-slate-500"
                                    )}
                                  >
                                    {cond}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button 
                    disabled={Object.keys(returningItems).length === 0}
                    onClick={handleReturnSubmit}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    確認歸還
                  </button>
                </div>
              )}

              {returnStep === 'success' && (
                <div className="text-center py-12 space-y-6">
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto"
                  >
                    <CheckCircle2 size={48} />
                  </motion.div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold">歸還成功！</h3>
                    <p className="text-slate-500">感謝您的配合，器材已入庫。</p>
                  </div>
                  <button 
                    onClick={() => { setView('home'); resetReturn(); }}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all"
                  >
                    返回首頁
                  </button>
                </div>
              )}
            </motion.div>
          )}
          {view === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => setView('home')}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold">借還紀錄後台</h2>
              </div>

              {/* Mobile Test Section */}
              <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-slate-800 rounded-lg text-blue-400">
                    <Smartphone size={20} />
                  </div>
                  <h3 className="text-lg font-bold">平板/手機 測試連線</h3>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="p-3 bg-white rounded-xl shadow-inner">
                    <QRCodeSVG 
                      value="https://ais-pre-knm6pan4fvhcokj3p5wuzx-338719927639.asia-northeast1.run.app" 
                      size={120}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  <div className="flex-1 space-y-3 text-center sm:text-left">
                    <p className="text-sm text-slate-300 leading-relaxed">
                      掃描 QR Code 或在平板瀏覽器輸入網址，即可在平板上測試借還功能：
                    </p>
                    <div className="flex items-center gap-2 p-2.5 bg-slate-800 rounded-xl border border-slate-700 font-mono text-[10px] break-all">
                      <span className="flex-1 text-blue-300">https://ais-pre-knm6pan4fvhcokj3p5wuzx-338719927639.asia-northeast1.run.app</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText("https://ais-pre-knm6pan4fvhcokj3p5wuzx-338719927639.asia-northeast1.run.app");
                          setNotification({ message: '網址已複製', type: 'success' });
                        }}
                        className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
                        title="複製網址"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-amber-400 flex items-center justify-center sm:justify-start gap-1.5">
                      <AlertTriangle size={12} />
                      提示：請確保您的平板已連上網路。
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setView('manage_equipment')}
                  className="flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-500 hover:text-blue-600 transition-all group"
                >
                  <Package size={20} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="font-bold text-sm">管理器材清單</span>
                </button>
                <button 
                  onClick={() => setView('manage_classes')}
                  className="flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-500 hover:text-blue-600 transition-all group"
                >
                  <Users size={20} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="font-bold text-sm">管理班級資料</span>
                </button>
                <button 
                  onClick={seedData}
                  className="col-span-2 flex items-center justify-center gap-2 p-3 bg-slate-100 rounded-xl text-slate-500 hover:bg-slate-200 transition-all"
                >
                  <RotateCcw size={16} />
                  <span className="font-bold text-xs">初始化範例資料</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest">所有紀錄</h3>
                  <span className="text-xs text-slate-400">共 {loans.length} 筆</span>
                </div>

                <div className="grid gap-3">
                  {[...loans].sort((a, b) => {
                    const timeA = a.borrowedAt?.seconds || 0;
                    const timeB = b.borrowedAt?.seconds || 0;
                    return timeB - timeA;
                  }).map(loan => (
                    <div key={loan.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                              {loan.className} 班
                            </span>
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                              loan.status === 'borrowed' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                            )}>
                              {loan.status === 'borrowed' ? '借用中' : '已歸還'}
                            </span>
                          </div>
                          <div className="font-bold text-slate-900">{loan.equipmentName} x {loan.quantity}</div>
                          <div className="text-xs text-slate-500">借用人: {loan.borrowerName}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400 font-medium">借用時間</div>
                          <div className="text-[11px] text-slate-600">
                            {loan.borrowedAt?.toDate().toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}
                          </div>
                        </div>
                      </div>

                      {loan.status === 'returned' && (
                        <div className="pt-3 border-t border-slate-50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-slate-400 font-medium">狀況:</div>
                            <div className="text-xs font-bold text-slate-700">{loan.condition || '良好'}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-400 font-medium">歸還時間</div>
                            <div className="text-[11px] text-slate-600">
                              {loan.returnedAt?.toDate().toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {loans.length === 0 && (
                    <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                      <History className="text-slate-200 mx-auto mb-2" size={48} />
                      <p className="text-slate-400">目前尚無紀錄</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'manage_equipment' && (
            <motion.div 
              key="manage_equipment"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => setView('home')}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold">器材清單管理</h2>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">新增器材</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => downloadTemplate('equipment')}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <Download size={12} /> 下載範本
                    </button>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 cursor-pointer transition-colors">
                      <FileUp size={12} /> CSV 匯入
                      <input type="file" accept=".csv" className="hidden" onChange={handleEquipmentCSV} />
                    </label>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">※ 若使用 Excel 存檔，請選擇「CSV UTF-8 (逗號分隔)」格式以避免亂碼。</p>
                <div className="space-y-3">
                  <input 
                    type="text" 
                    placeholder="器材名稱"
                    value={newEquip.name}
                    onChange={e => setNewEquip({ ...newEquip, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input 
                    type="text" 
                    placeholder="存放位置 (例如: 器材室 A1)"
                    value={newEquip.location}
                    onChange={e => setNewEquip({ ...newEquip, location: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      placeholder="總數量"
                      value={newEquip.totalQuantity || ''}
                      onChange={e => setNewEquip({ ...newEquip, totalQuantity: parseInt(e.target.value) || 0 })}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select 
                      value={newEquip.category}
                      onChange={e => setNewEquip({ ...newEquip, category: e.target.value })}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="球類">球類</option>
                      <option value="體適能">體適能</option>
                      <option value="大型器材">大型器材</option>
                      <option value="小型器材">小型器材</option>
                    </select>
                  </div>
                  <button 
                    onClick={handleAddEquipment}
                    className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
                  >
                    新增器材
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest px-1">現有器材</h3>
                <div className="grid gap-3">
                  {equipment.map(item => (
                    <div key={item.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                      {isEditing === item.id ? (
                        <>
                          <div className="flex-1 flex flex-col gap-2">
                            <div className="flex gap-2">
                              <input 
                                type="text" 
                                defaultValue={item.name}
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                                onBlur={e => handleUpdateEquipment(item.id, { name: e.target.value })}
                              />
                              <input 
                                type="number" 
                                defaultValue={item.totalQuantity}
                                className="w-16 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                                onBlur={e => handleUpdateEquipment(item.id, { totalQuantity: parseInt(e.target.value) || 0 })}
                              />
                              <select 
                                defaultValue={item.category}
                                className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs"
                                onChange={e => handleUpdateEquipment(item.id, { category: e.target.value })}
                              >
                                <option value="球類">球類</option>
                                <option value="體適能">體適能</option>
                                <option value="大型器材">大型器材</option>
                                <option value="小型器材">小型器材</option>
                              </select>
                            </div>
                            <input 
                              type="text" 
                              defaultValue={item.location}
                              placeholder="存放位置"
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs"
                              onBlur={e => handleUpdateEquipment(item.id, { location: e.target.value })}
                            />
                          </div>
                          <button onClick={() => setIsEditing(null)} className="text-slate-400 ml-2"><X size={18} /></button>
                        </>
                      ) : (
                        <>
                          <div>
                            <div className="font-bold">{item.name}</div>
                            <div className="text-xs text-slate-400">
                              總數: {item.totalQuantity} | 庫存: {item.availableQuantity} | 已借出: {item.totalQuantity - item.availableQuantity} | 分類: {item.category} {item.location && `| 存放: ${item.location}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => setIsEditing(item.id)}
                              className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button 
                              onClick={() => handleDeleteEquipment(item.id)}
                              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'manage_classes' && (
            <motion.div 
              key="manage_classes"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => setView('home')}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold">班級資料管理</h2>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">新增班級</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => downloadTemplate('class')}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <Download size={12} /> 下載範本
                    </button>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 cursor-pointer transition-colors">
                      <FileUp size={12} /> CSV 匯入
                      <input type="file" accept=".csv" className="hidden" onChange={handleClassCSV} />
                    </label>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">※ 若使用 Excel 存檔，請選擇「CSV UTF-8 (逗號分隔)」格式以避免亂碼。</p>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="班級名稱 (如: 101)"
                    value={newClass.className}
                    onChange={e => setNewClass({ ...newClass, className: e.target.value })}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input 
                    type="text" 
                    placeholder="條碼編號"
                    value={newClass.barcode}
                    onChange={e => setNewClass({ ...newClass, barcode: e.target.value })}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button 
                  onClick={handleAddClass}
                  className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors"
                >
                  新增班級
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest px-1">現有班級</h3>
                <div className="grid gap-3">
                  {classes.map(cls => (
                    <div key={cls.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="font-bold">{cls.className} 班</div>
                        <div className="text-xs text-slate-400">條碼: {cls.barcode}</div>
                      </div>
                      <button 
                        onClick={() => handleDeleteClass(cls.id)}
                        className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="max-w-md mx-auto px-4 py-8 text-center">
        <p className="text-slate-400 text-xs">© 2026 體育器材自助借還系統</p>
      </footer>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3",
              notification.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
            )}
          >
            {notification.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold text-sm">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
                <Trash2 size={32} />
              </div>
              <div className="text-center space-y-2">
                <h3 className="font-bold text-xl text-slate-900">確認刪除</h3>
                <p className="text-slate-500 text-sm">{confirmModal.title}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={executeDelete}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
                >
                  確定刪除
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
