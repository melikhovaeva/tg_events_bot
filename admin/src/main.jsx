import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  Copy,
  FileText,
  GripVertical,
  ImagePlus,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Replace,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import "./styles.css";

const statusNames = {
  awaiting_review: "Новая заявка",
  invited: "Ждёт ответа",
  pending: "Ждёт ответа",
  confirmed: "Подтвердил",
  declined: "Отказался",
  expired: "Срок истёк",
};
const fmt = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const count = (value) => Number(value || 0);
async function request(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error("Не удалось сохранить изменения");
  return r;
}

function SortableImage({ image, onRemove, onReplace }) {
  const s = useSortable({ id: image.id });
  return (
    <div
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
      }}
      className={`group relative aspect-square overflow-hidden rounded-md border bg-muted ${s.isDragging ? "z-10 opacity-50 ring-2 ring-ring" : ""}`}
    >
      <img src={image.url} className="h-full w-full object-cover" />
      <button
        type="button"
        className="absolute left-1 top-1 cursor-grab rounded bg-background/85 p-1 opacity-0 shadow-sm group-hover:opacity-100"
        {...s.attributes}
        {...s.listeners}
      >
        <GripVertical size={15} />
      </button>
      <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100">
        <label className="cursor-pointer rounded bg-background/90 p-1.5 shadow-sm">
          <Replace size={14} />
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onReplace(image.id, e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          onClick={() => onRemove(image.id)}
          className="rounded bg-destructive p-1.5 text-white"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
function ImagePicker({ images, setImages }) {
  const ref = useRef(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const add = (files) =>
    setImages((current) => [
      ...current,
      ...Array.from(files || [])
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, 9 - current.length)
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
    ]);
  const sort = ({ active, over }) =>
    over &&
    active.id !== over.id &&
    setImages((current) =>
      arrayMove(
        current,
        current.findIndex((i) => i.id === active.id),
        current.findIndex((i) => i.id === over.id),
      ),
    );
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={sort}
        >
          <SortableContext
            items={images.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            {images.map((i) => (
              <SortableImage
                key={i.id}
                image={i}
                onRemove={(id) =>
                  setImages((c) => c.filter((i) => i.id !== id))
                }
                onReplace={(id, file) =>
                  file &&
                  setImages((c) =>
                    c.map((i) =>
                      i.id === id
                        ? { id, file, url: URL.createObjectURL(file) }
                        : i,
                    ),
                  )
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        {images.length < 9 && (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="flex aspect-square flex-col items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent"
          >
            <ImagePlus size={20} />
            Добавить
          </button>
        )}
      </div>
      <input
        ref={ref}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-xs font-normal text-muted-foreground">
        {images.length}/9 изображений. Перетаскивайте за ручку; при наведении
        доступны замена и удаление.
      </p>
    </div>
  );
}
function CreateDialog({ open, setOpen, create }) {
  const [images, setImages] = useState([]);
  const submit = async (e) => {
    e.preventDefault();
    await create(e.currentTarget, images);
    e.currentTarget.reset();
    setImages([]);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новое мероприятие</DialogTitle>
          <DialogDescription>
            Карточка и анонс будут готовы сразу после создания.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Название
            <Input name="title" required />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Дата и время
            <Input name="starts_at" type="datetime-local" required />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Место
            <Input name="venue" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Изображения карточки
            <ImagePicker images={images} setImages={setImages} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Текст анонса
            <Textarea
              name="description"
              placeholder="Абзацы, эмодзи и ссылки поддерживаются"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Ссылка на чат
            <Input name="chat_url" placeholder="https://t.me/..." />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button>Создать мероприятие</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Stat({ label, value }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function EventTexts({ event, onSaved }) {
  const [texts, setTexts] = useState({ description: '', invite_text: '', declined_text: '' });
  const [saved, setSaved] = useState(false);
  useEffect(() => setTexts({ description: event.description || '', invite_text: event.invite_text || '', declined_text: event.declined_text || '' }), [event]);
  const save = async e => {
    e.preventDefault();
    await request(`/api/admin/events/${event.id}/texts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(texts) });
    setSaved(true); onSaved(); window.setTimeout(() => setSaved(false), 1800);
  };
  const field = (key, title, hint) => <label className="grid gap-1.5 text-sm font-medium">{title}<Textarea value={texts[key]} onChange={e => setTexts({ ...texts, [key]: e.target.value })} placeholder={hint}/></label>;
  return <Card className="mt-6"><CardHeader><CardTitle>Тексты события</CardTitle><CardDescription>Используйте <code>{'{event}'}</code> в приглашении — бот подставит название мероприятия.</CardDescription></CardHeader><CardContent><form onSubmit={save} className="grid gap-5">{field('description', 'Карточка мероприятия', 'Что увидит человек перед подачей заявки')}{field('invite_text', 'Приглашение', 'Приглашение на {event}')}{field('declined_text', 'Отказ', 'Спасибо, что сообщили. Будем рады видеть вас на следующих мероприятиях!')}<div><Button>{saved ? <Check size={15}/> : null}{saved ? 'Сохранено' : 'Сохранить тексты'}</Button></div></form></CardContent></Card>;
}

function App() {
  const [state, setState] = useState({
    events: [],
    people: [],
    guests: [],
    assets: [],
  });
  const [page, setPage] = useState("events");
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const load = async (id) => {
    try {
      const r = await request(`/api/admin/state${id ? `?event=${id}` : ""}`);
      const data = await r.json();
      setState(data);
      setActive(data.selected || null);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const event = state.events.find((e) => e.id === active);
  const create = async (form, images) => {
    const body = new FormData(form);
    images.forEach((i) => body.append("images", i.file));
    await request("/admin/events", { method: "POST", body });
    await load();
  };
  const invite = async (id) => {
    await request(`/admin/invite/${id}`, { method: "POST" });
    await load(active);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(
      `https://t.me/${state.botUsername}?start=event_${event.id}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const openEvent = (id) => {
    load(id);
    setPage("detail");
  };
  const nav = [
    { id: "events", label: "Мероприятия", icon: LayoutDashboard },
    { id: "guests", label: "Гости", icon: Users },
    { id: "posts", label: "Посты", icon: MessageSquare },
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <b>Event Ops</b>
          <nav className="flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${page === item.id ? "bg-accent font-medium" : "hover:bg-accent"}`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Создать мероприятие
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl min-w-0 p-6 lg:p-10">
          {error && (
            <p className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {page === "events" && (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">
                Мероприятия
              </h1>
              <p className="mt-2 text-muted-foreground">
                Выберите событие, чтобы открыть гостей, тексты и материалы.
              </p>
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                {state.events.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openEvent(item.id)}
                    className="rounded-xl border bg-card p-5 text-left shadow-sm transition hover:border-foreground/30"
                  >
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <CalendarDays size={14} />
                      {fmt(item.starts_at)}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      <Stat label="заявок" value={count(item.registered)} />
                      <Stat label="приглашений" value={count(item.invited)} />
                      <Stat label="подтвердили" value={count(item.confirmed)} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {page === "detail" && event && (
            <>
              <button
                onClick={() => setPage("events")}
                className="mb-5 text-sm text-muted-foreground hover:text-foreground"
              >
                ← Все мероприятия
              </button>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {event.title}
                  </h1>
                  <p className="mt-2 text-muted-foreground">
                    {fmt(event.starts_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPage("texts")}>
                    <FileText size={15} />
                    Тексты
                  </Button>
                  <Button variant="outline" onClick={copy}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied ? "Скопировано" : "Скопировать ссылку"}
                  </Button>
                </div>
              </div>
              <div className="mt-7 grid gap-4 md:grid-cols-3">
                <Stat
                  label="зарегистрировалось"
                  value={count(event.registered)}
                />
                <Stat label="приглашений" value={count(event.invited)} />
                <Stat
                  label="подтвердило участие"
                  value={count(event.confirmed)}
                />
              </div>
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Заявки</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-3">Участник</th>
                        <th className="pb-3">Telegram</th>
                        <th className="pb-3">Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.people.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-3">
                            <b>{p.name}</b>
                            <br />
                            <span className="text-muted-foreground">
                              {p.phone}
                            </span>
                          </td>
                          <td className="py-3">
                            {p.telegram_name ? `@${p.telegram_name}` : "—"}
                          </td>
                          <td className="py-3">
                            {statusNames[p.invitation_status || p.status]}
                          </td>
                          <td className="py-3 text-right">
                            {p.telegram_id &&
                              !["pending", "confirmed"].includes(
                                p.invitation_status,
                              ) && (
                                <Button size="sm" onClick={() => invite(p.id)}>
                                  <Send size={14} />
                                  Пригласить
                                </Button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
          {page === "texts" && event && (
            <>
              <button
                onClick={() => setPage("detail")}
                className="mb-5 text-sm text-muted-foreground hover:text-foreground"
              >
                ← {event.title}
              </button>
              <h1 className="text-3xl font-semibold tracking-tight">
                Тексты события
              </h1>
              <p className="mt-2 text-muted-foreground">
                Настройте карточку мероприятия, приглашение и сообщение об отказе.
              </p>
              <EventTexts event={event} onSaved={() => load(event.id)} />
            </>
          )}
          {page === "guests" && (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">Гости</h1>
              <p className="mt-2 text-muted-foreground">
                Единая база людей, которые уже были в ваших событиях или подали
                заявку.
              </p>
              <Card className="mt-7">
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-4">Гость</th>
                        <th className="p-4">Telegram</th>
                        <th className="p-4">Событий</th>
                        <th className="p-4">Последняя заявка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.guests.map((g) => (
                        <tr
                          key={g.telegram_id || g.name}
                          className="border-b last:border-0"
                        >
                          <td className="p-4">
                            <b>{g.name}</b>
                            <br />
                            <span className="text-muted-foreground">
                              {g.phone}
                            </span>
                          </td>
                          <td className="p-4">
                            {g.telegram_name ? `@${g.telegram_name}` : "—"}
                          </td>
                          <td className="p-4">{g.events_count}</td>
                          <td className="p-4 text-muted-foreground">
                            {fmt(g.last_seen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
          {page === "posts" && (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">Посты</h1>
              <p className="mt-2 text-muted-foreground">
                Подготовьте сообщение и выберите, кому оно предназначено.
              </p>
              <Card className="mt-7 max-w-2xl">
                <CardHeader>
                  <CardTitle>Новый пост</CardTitle>
                  <CardDescription>
                    Перед массовой отправкой система покажет число получателей.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <label className="grid gap-1.5 text-sm font-medium">
                    Аудитория
                    <select className="h-9 rounded-md border bg-background px-3 text-sm">
                      <option>Все, кто запустил бота</option>
                      {state.events.map((e) => (
                        <option key={e.id}>
                          Зарегистрированные: {e.title}
                        </option>
                      ))}
                      <option>Выбрать гостей вручную</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Текст поста
                    <Textarea placeholder="Напишите сообщение для гостей" />
                  </label>
                  <Button disabled>
                    <Send size={15} />
                    Подготовить отправку
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Массовая отправка будет отдельным подтверждаемым шагом.
                  </p>
                </CardContent>
              </Card>
            </>
          )}
      </main>
      <CreateDialog open={open} setOpen={setOpen} create={create} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
