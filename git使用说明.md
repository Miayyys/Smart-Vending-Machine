先创建一个文件夹Smart-Vending-Machine

cd进入文件夹，输入初始化仓库：

```
git init
```

接着设置远程仓库：

```
git remote add myserver root@8.134.211.29:/home/Smart-Vending-Machine/SVM.git
```

拉取main分支：

```
git push -f  myserver main
```

**接下来很重要！！！：**

根据自己任务创建分支,3选一：

```
git branch server //服务器
git branch yolo //模型识别
git branch hardware //硬件驱动
```

切换到自己负责分支,例如：

```
git checkout server//yolo就把server换成yolo，硬件就把server换成hardware
```

后续开发在自己分支和文件夹进行，例如服务器的相关文件都放在SVM-Server，分支使用server。

开发完成一定进度使用git本地保存，本地保存可以叫ai完成，确认无误后推送到远程仓库：

**推送前一定注意推送到自己分支，特别重要！！**

推送指令：

```
git push -f  myserver server//yolo就把server换成yolo，硬件就把server换成hardware
```

**一定要注意最推送的分支是不是自己负责的分支！！**



把远程仓库同步到本地：

如果本地有问题无法撤回可以把远程仓库同步到本地

要同步到本地哪个分支就切换到对应分支：

```
git checkout server
```

再进行同步：

```
git pull myserver
```


